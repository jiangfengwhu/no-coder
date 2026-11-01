import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

describe('hibernating queue WebSocket integration', () => {
  let runtime;
  const origin = 'https://queue.test';
  beforeAll(async () => {
    const bundle = await build({ entryPoints: ['backend/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
    runtime = new Miniflare(convertV4MiniflareOptions({ name: 'realtime-test', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-10-30',
      durableObjects: { AGENT_QUEUE: { className: 'AgentQueue', useSQLite: true } },
      bindings: { GITHUB_OWNER: 'test', GITHUB_REPO: 'test', GITHUB_BRANCH: 'main', AUTO_MERGE: 'false', DEPLOY_MODE: 'jules', QUEUE_ADMIN_TOKEN: 'test-admin' },
    }));
  });
  afterAll(async () => { await runtime?.dispose(); });

  async function connection(cookie) {
    const response = await runtime.dispatchFetch(`${origin}/api/queue/live`, { headers: { Origin: origin, Upgrade: 'websocket', Cookie: cookie } });
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    const messages = [];
    const pending = [];
    socket.addEventListener('message', event => { const next = pending.shift(); if (next) next(event.data); else messages.push(event.data); });
    socket.accept();
    return { socket, next: () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No WebSocket snapshot received')), 3000);
      pending.push(message => { clearTimeout(timer); resolve(message); });
    }) };
  }

  it('rejects cross-origin upgrades and non-WebSocket requests', async () => {
    const foreign = await runtime.dispatchFetch(`${origin}/api/queue/live`, { headers: { Origin: 'https://other.test', Upgrade: 'websocket' } });
    expect(foreign.status).toBe(403);
    const plain = await runtime.dispatchFetch(`${origin}/api/queue/live`, { headers: { Origin: origin } });
    expect(plain.status).toBe(426);
  });

  it('restricts runtime reporting origins and supports canvas CORS preflight', async () => {
    const foreign = await runtime.dispatchFetch(`${origin}/api/runtime-report`, { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{}' });
    expect(foreign.status).toBe(403);
    const preflight = await runtime.dispatchFetch(`${origin}/api/runtime-report`, { method: 'OPTIONS', headers: { Origin: 'https://nocoder-canvas.297782.xyz' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://nocoder-canvas.297782.xyz');
    const invalid = await runtime.dispatchFetch(`${origin}/api/runtime-report`, { method: 'POST', headers: { Origin: 'https://nocoder-canvas.297782.xyz', 'Content-Type': 'application/json' }, body: '{}' });
    expect(invalid.status).toBe(400);
  });

  it('pushes changes to both visitors with isolated ownership, supports refresh and auto ping/pong', async () => {
    const initialA = await runtime.dispatchFetch(`${origin}/api/queue`);
    const initialB = await runtime.dispatchFetch(`${origin}/api/queue`);
    const cookieA = initialA.headers.get('Set-Cookie').split(';')[0];
    const cookieB = initialB.headers.get('Set-Cookie').split(';')[0];
    const a = await connection(cookieA);
    const b = await connection(cookieB);
    expect(JSON.parse(await a.next()).type).toBe('queue');
    expect(JSON.parse(await b.next()).data.total).toBe(0);
    await runtime.unsafeEvictDurableObject('realtime-test', 'AgentQueue', { name: 'global-v1', webSockets: 'hibernate' });
    a.socket.send('ping');
    expect(await a.next()).toBe('pong');
    const posted = await runtime.dispatchFetch(`${origin}/api/requests`, { method: 'POST',
      headers: { Origin: origin, Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '实时队列测试', description: '这是一条仅存在于本地测试运行时的需求。', acceptance: '', requestId: 'websocket-test-request-0001' }),
    });
    expect(posted.status).toBe(201);
    const forA = JSON.parse(await a.next()).data;
    const forB = JSON.parse(await b.next()).data;
    expect(forA.jobs[0].mine).toBe(true);
    expect(forB.jobs[0].mine).toBe(false);
    expect(forB.jobs[0].title).toBe('实时队列测试');
    expect(JSON.stringify(forB)).not.toContain('ownerHash');
    expect(JSON.stringify(forB)).not.toContain('requestId');
    a.socket.send('ping');
    expect(await a.next()).toBe('pong');
    b.socket.send('refresh');
    expect(JSON.parse(await b.next()).data.total).toBe(1);
    a.socket.close(1000); b.socket.close(1000);
  });

  it('clears stored queue data only after administrator authentication', async () => {
    const post = authorization => runtime.dispatchFetch(`${origin}/api/admin`, { method: 'POST', headers: { Origin: origin, Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset_all' }) });
    expect((await post('Bearer wrong')).status).toBe(403);
    expect((await post('Bearer test-admin')).status).toBe(200);
    expect(await (await runtime.dispatchFetch(`${origin}/api/queue`)).json()).toMatchObject({ total: 0, activeId: null, paused: false });
    await runtime.unsafeEvictDurableObject('realtime-test', 'AgentQueue', { name: 'global-v1' });
    expect(await (await runtime.dispatchFetch(`${origin}/api/queue`)).json()).toMatchObject({ total: 0, activeId: null, paused: false });
  });
});
