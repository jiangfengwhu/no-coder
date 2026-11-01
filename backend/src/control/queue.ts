import { DurableObject } from 'cloudflare:workers';
import { QueueEngine } from './engine';
import { LiveProviders } from './providers';
import { digest, jsonBody, secretMatches, textField } from './security';
import { HttpError, missingConfig, type Env, type Job, type QueueMeta, type QueueStore } from './types';
import { checkTokens } from './diagnostics';
import { runtimeReport } from './runtime-report';

class DurableStore implements QueueStore {
  constructor(private storage: DurableObjectStorage) {}
  loadMeta() { return this.storage.get<QueueMeta>('meta'); }
  async listJobs() { return [...(await this.storage.list<Job>({ prefix: 'job:' })).values()]; }
  async save(meta: QueueMeta, job?: Job) {
    await this.storage.transaction(async tx => {
      await tx.put('meta', meta);
      if (job) await tx.put(`job:${job.id}`, job);
    });
  }
}

export class AgentQueue extends DurableObject<Env> {
  private engine: QueueEngine;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.engine = new QueueEngine(new DurableStore(ctx.storage), new LiveProviders(env), env, () => Date.now(), () => {
      this.ctx.waitUntil(this.broadcast());
    });
  }

  private async broadcast() {
    const snapshots = new Map<string, string>();
    for (const socket of this.ctx.getWebSockets()) {
      try {
        const ownerHash = socket.deserializeAttachment()?.ownerHash;
        if (typeof ownerHash !== 'string' || !/^[a-f0-9]{64}$/.test(ownerHash)) { socket.close(1008, 'Invalid identity'); continue; }
        if (!snapshots.has(ownerHash)) snapshots.set(ownerHash, JSON.stringify({ type: 'queue', data: await this.engine.view(ownerHash) }));
        socket.send(snapshots.get(ownerHash)!);
      } catch { try { socket.close(1011, 'Connection closed'); } catch { /* already closed */ } }
    }
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (message !== 'refresh') { socket.close(1008, 'Unsupported message'); return; }
    const attachment = socket.deserializeAttachment();
    if (!attachment?.ownerHash || (attachment.lastRefresh && Date.now() - attachment.lastRefresh < 2000)) return;
    socket.serializeAttachment({ ...attachment, lastRefresh: Date.now() });
    socket.send(JSON.stringify({ type: 'queue', data: await this.engine.view(attachment.ownerHash) }));
  }

  webSocketClose(socket: WebSocket, code: number) {
    // Also complete the handshake explicitly for runtimes that have not enabled auto-close replies.
    try { socket.close(code === 1005 || code === 1006 ? 1000 : code, 'Connection closed'); } catch { /* already closed */ }
  }
  webSocketError(socket: WebSocket) { try { socket.close(1011, 'Connection error'); } catch { /* already closed */ } }

  private async schedule() {
    const state = await this.engine.view('');
    const needsWork = state.configured && !state.paused && (state.activeId || state.jobs.some(job => job.state === 'queued'));
    const current = await this.ctx.storage.getAlarm();
    if (needsWork) {
      if (!current || (!state.activeId && current > Date.now() + 2000)) await this.ctx.storage.setAlarm(Date.now() + 1000);
    } else if (state.configured && !state.paused && this.env.AUTO_CREATIVE === 'true') {
      const now = Date.now();
      const nextDay = (Math.floor((now + 8 * 60 * 60 * 1000) / 86_400_000) + 1) * 86_400_000 - 8 * 60 * 60 * 1000;
      const day = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const due = this.engine.meta.autoDay === day && (this.engine.meta.autoCount ?? 0) >= 70 ? nextDay : now + 1000;
      if (!current || current > due) await this.ctx.storage.setAlarm(due);
    } else if (current) await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    // Schedule recovery before network work; a terminated invocation can resume safely.
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    try { await this.engine.tick(); }
    finally { await this.schedule(); }
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const ownerHash = request.headers.get('X-Visitor-Hash') ?? '';
      if (request.method === 'GET' && url.pathname === '/api/queue/live') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new HttpError(426, '需要 WebSocket 连接。');
        if (!/^[a-f0-9]{64}$/.test(ownerHash)) throw new HttpError(403, '浏览器身份无效。');
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ ownerHash });
        await this.schedule();
        server.send(JSON.stringify({ type: 'queue', data: await this.engine.view(ownerHash) }));
        return new Response(null, { status: 101, webSocket: client });
      }
      if (request.method === 'GET' && url.pathname === '/api/queue') {
        await this.schedule();
        return Response.json(await this.engine.view(ownerHash));
      }
      if (request.method !== 'POST') throw new HttpError(404, '接口不存在。');
      const body = await jsonBody(request);
      if (url.pathname === '/api/runtime-report') {
        const rateKey = `runtime-rate:${request.headers.get('X-IP-Hash')}`;
        await this.ctx.storage.transaction(async tx => {
          const rate = await tx.get<{ at: number; count: number }>(rateKey);
          if (rate && Date.now() - rate.at < 60_000 && rate.count >= 6) throw new HttpError(429, '报告过于频繁。');
          await tx.put(rateKey, rate && Date.now() - rate.at < 60_000 ? { ...rate, count: rate.count + 1 } : { at: Date.now(), count: 1 });
        });
        const result = await this.engine.reportRuntime(runtimeReport(body));
        await this.schedule();
        return Response.json(result);
      }
      if (url.pathname === '/api/admin/check-tokens') {
        const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
        if (!await secretMatches(bearer, this.env.QUEUE_ADMIN_TOKEN)) throw new HttpError(403, '管理密钥无效。');
        return Response.json(await checkTokens(this.env), { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/api/deploy/credentials') {
        const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
        return Response.json(await this.engine.deploymentCredentials(textField(body, 'jobId', 36, 36), token), { headers: { 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/api/requests') {
        if (this.env.SUBMISSION_TOKEN && !await secretMatches(String(body.inviteCode ?? ''), this.env.SUBMISSION_TOKEN)) {
          throw new HttpError(403, '请输入正确的邀请码。');
        }
        const input = {
          title: textField(body, 'title', 2, 100), description: textField(body, 'description', 10, 6000),
          acceptance: textField(body, 'acceptance', 0, 2000), requestId: textField(body, 'requestId', 16, 80),
        };
        const ipHash = request.headers.get('X-IP-Hash') ?? '';
        const rateKey = `rate:${await digest(ipHash)}`;
        // Transport-level atomic throttle prevents resetting cookies to bypass submission limits.
        await this.ctx.storage.transaction(async tx => {
          const times = (await tx.get<number[]>(rateKey) ?? []).filter(time => Date.now() - time < 60_000);
          if (times.length >= 5) throw new HttpError(429, '当前网络提交频率过高，请稍后再试。');
          await tx.put(rateKey, [...times, Date.now()]);
        });
        const id = await this.engine.submit(input, ownerHash, ipHash);
        await this.schedule();
        return Response.json({ id }, { status: 201 });
      }
      const feedback = url.pathname.match(/^\/api\/requests\/([\w-]+)\/feedback$/);
      if (feedback) {
        await this.engine.feedback(feedback[1], ownerHash, textField(body, 'message', 1, 6000));
        await this.schedule();
        return Response.json({ ok: true });
      }
      if (url.pathname === '/api/admin') {
        const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
        if (!await secretMatches(bearer, this.env.QUEUE_ADMIN_TOKEN)) throw new HttpError(403, '管理密钥无效。');
        const action = textField(body, 'action', 1, 40);
        if (action === 'mark_stable') { await this.engine.markStable(); return Response.json({ ok: true }); }
        if (action === 'inspect_active') {
          const view = await this.engine.view('');
          const active = view.jobs.find(job => job.id === view.activeId);
          if (!active?.sessionId) throw new HttpError(409, '当前任务没有关联会话。');
          const remote = await new LiveProviders(this.env).session(active.sessionId);
          return Response.json({ state: remote.state, pullRequest: remote.outputs?.find(output => output.pullRequest?.url)?.pullRequest?.url ?? null });
        }
        if (action === 'reset_all') {
          await this.engine.exclusive(async () => {
            await this.ctx.storage.deleteAlarm();
            await this.ctx.storage.deleteAll();
          });
          this.engine = new QueueEngine(new DurableStore(this.ctx.storage), new LiveProviders(this.env), this.env, () => Date.now(), () => { this.ctx.waitUntil(this.broadcast()); });
          await this.broadcast();
          return Response.json({ ok: true });
        }
        if (action === 'resume' && missingConfig(this.env).length) throw new HttpError(409, '请先完成后端环境变量配置。');
        await this.engine.admin(action, {
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
          confirmRemoteStopped: body.confirmRemoteStopped === true,
          message: typeof body.message === 'string' ? textField(body, 'message', 1, 6000) : undefined,
        });
        await this.schedule();
        return Response.json({ ok: true });
      }
      throw new HttpError(404, '接口不存在。');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      return Response.json({ error: status === 500 ? '后端暂时不可用，请稍后重试。' : (error as Error).message }, { status });
    }
  }
}
