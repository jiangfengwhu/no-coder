import { HttpError, isTerminal, missingConfig, type Env, type Job, type PublicJob, type QueueMeta, type QueueStore, type QueueView } from './types';
import { prNumberFromUrl, UpstreamError, type Providers } from './providers';
import { deploymentLease, secretMatches } from './security';

const MAX_WAITING = 100;
const MAX_RUNTIME = 2 * 60 * 60 * 1000;

export class QueueEngine {
  meta: QueueMeta = { nextNumber: 1, activeId: null, paused: false };
  jobs = new Map<string, Job>();
  private ready: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private store: QueueStore, private providers: Providers, private env: Env, private now = () => Date.now()) {
    this.ready = this.load();
  }

  private async load() {
    this.meta = await this.store.loadMeta() ?? this.meta;
    this.jobs = new Map((await this.store.listJobs()).map(job => [job.id, job]));
  }

  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => { await this.ready; return fn(); });
    this.tail = result.catch(() => {});
    return result;
  }

  private date() { return new Date(this.now()).toISOString(); }

  private async save(job?: Job, event?: string) {
    if (job) {
      job.updatedAt = this.date();
      if (event) job.events = [...job.events, { at: this.date(), text: event }].slice(-30);
      this.jobs.set(job.id, job);
    }
    await this.store.save(this.meta, job);
  }

  private async pause(job: Job, message: string) {
    job.message = message;
    this.meta.paused = true;
    this.meta.pauseReason = message;
    await this.save(job, message);
  }

  private async finish(job: Job, state: 'completed' | 'failed', message: string) {
    job.state = state;
    job.message = message;
    job.completedAt = this.date();
    this.meta.activeId = null;
    await this.save(job, message);
  }

  async view(ownerHash: string): Promise<QueueView> {
    await this.ready;
    const jobs = [...this.jobs.values()].sort((a, b) => b.number - a.number);
    const waiting = jobs.filter(job => job.state === 'queued').reverse();
    return {
      // Keep all unfinished tasks plus the last 100 terminal records in the public view.
      jobs: jobs.filter(job => !isTerminal(job)).concat(jobs.filter(isTerminal).slice(0, 100)).sort((a, b) => b.number - a.number).map(job => {
        const { ownerHash: owner, requestId: _requestId, ...publicJob } = job;
        return { ...publicJob, mine: owner === ownerHash, position: job.state === 'queued' ? waiting.findIndex(item => item.id === job.id) + 1 : null } satisfies PublicJob;
      }),
      total: jobs.length,
      activeId: this.meta.activeId,
      paused: this.meta.paused,
      pauseReason: this.meta.pauseReason,
      configured: missingConfig(this.env).length === 0,
      missing: missingConfig(this.env),
      autoMerge: this.env.AUTO_MERGE === 'true',
      inviteRequired: Boolean(this.env.SUBMISSION_TOKEN),
      repositoryUrl: this.env.GITHUB_OWNER && this.env.GITHUB_REPO ? `https://github.com/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}` : undefined,
      latestCommit: this.meta.latestCommit,
    };
  }

  submit(input: { title: string; description: string; acceptance: string; requestId: string }, ownerHash: string, ipHash: string) {
    return this.exclusive(async () => {
      const duplicate = [...this.jobs.values()].find(job => job.requestId === input.requestId && job.ownerHash === ownerHash);
      if (duplicate) return duplicate.id;
      const unfinished = [...this.jobs.values()].filter(job => !isTerminal(job));
      if (unfinished.length >= MAX_WAITING) throw new HttpError(429, '队列已满，请稍后再来。');
      if (unfinished.filter(job => job.ownerHash === ownerHash).length >= 3) throw new HttpError(429, '你已有 3 条未完成的需求，请等待处理后再提交。');
      // IP throttles are stored separately by the DO transport; this check limits per-browser bursts.
      void ipHash;
      if ([...this.jobs.values()].some(job => job.ownerHash === ownerHash && this.now() - Date.parse(job.createdAt) < 15_000)) {
        throw new HttpError(429, '提交得太快了，请等 15 秒再试。');
      }
      const job: Job = {
        ...input, id: crypto.randomUUID(), number: this.meta.nextNumber++, ownerHash, state: 'queued',
        createdAt: this.date(), updatedAt: this.date(), events: [{ at: this.date(), text: '需求已加入队列。' }],
      };
      await this.save(job);
      return job.id;
    });
  }

  feedback(id: string, ownerHash: string, message: string) {
    return this.exclusive(async () => {
      const job = this.jobs.get(id);
      if (!job || job.ownerHash !== ownerHash) throw new HttpError(403, '只能补充你在当前浏览器提交的需求。');
      if (job.state !== 'needs_input' || !job.sessionId) throw new HttpError(409, '当前任务没有等待补充说明。');
      await this.providers.message(job.sessionId, message);
      job.state = 'running';
      job.message = '补充说明已发送，等待 Jules 继续处理。';
      await this.save(job, job.message);
    });
  }

  deploymentCredentials(jobId: string, token: string) {
    return this.exclusive(async () => {
      const job = this.jobs.get(jobId);
      if (!job || this.meta.activeId !== jobId || this.meta.paused || !['creating', 'running', 'needs_input', 'checking'].includes(job.state)) {
        throw new HttpError(403, '此任务当前没有发布权限。');
      }
      if (missingConfig(this.env).length) throw new HttpError(503, '请先在 Cloudflare Worker 中替换必要的 Secret 占位值。');
      const expected = await deploymentLease(jobId, this.env.QUEUE_ADMIN_TOKEN!);
      if (!await secretMatches(token, expected)) throw new HttpError(403, '任务发布授权无效。');
      return { apiToken: this.env.CLOUDFLARE_API_TOKEN, accountId: '9f38af437152e2268766afd8fdb6cf72', appUrl: this.env.APP_URL || 'https://nocoder.297782.xyz' };
    });
  }

  admin(action: string, options: { sessionId?: string; confirmRemoteStopped?: boolean } = {}) {
    return this.exclusive(async () => {
      const active = this.meta.activeId ? this.jobs.get(this.meta.activeId) : undefined;
      if (action === 'pause') {
        this.meta.paused = true;
        this.meta.pauseReason = '管理员已暂停调度。';
      } else if (action === 'resume') {
        this.meta.paused = false;
        this.meta.pauseReason = undefined;
        if (active) active.startedAt = this.date();
      } else if (action === 'approve_merge') {
        if (active?.state !== 'ready_to_merge') throw new HttpError(409, '当前没有等待合并的任务。');
        active.mergeApproved = true;
        active.state = 'checking';
      } else if (action === 'attach_session') {
        if (!active || active.sessionId || !/^[\w-]+$/.test(options.sessionId ?? '')) throw new HttpError(409, '当前任务不能绑定此 session。');
        const remote = await this.providers.session(options.sessionId!);
        if (!remote.title?.startsWith(`[NC-${active.id}]`)) throw new HttpError(409, 'session 的任务标记不匹配。');
        active.sessionId = options.sessionId;
        active.sessionUrl = `https://jules.google.com/session/${options.sessionId}`;
        active.state = 'running';
        this.meta.paused = false;
        this.meta.pauseReason = undefined;
      } else if (action === 'retry_active') {
        if (!active || active.state !== 'creating' || active.sessionId) throw new HttpError(409, '仅能重试尚未确认创建结果的任务。');
        // Reconcile the entire bounded remote list before permitting another non-idempotent POST.
        const remote = await this.providers.reconcile(active);
        if (remote) {
          const id = remote.name?.match(/^sessions\/([\w-]+)$/)?.[1];
          if (!id) throw new HttpError(409, '远端会话 ID 无法解析，未启动新的会话。');
          active.sessionId = id;
          active.sessionUrl = `https://jules.google.com/session/${id}`;
          active.state = 'running';
          active.message = '已找回已有 Jules 会话，继续原任务。';
        } else {
          active.state = 'queued';
          active.message = '已核对远端没有此任务会话，重新排入队列。';
          this.meta.activeId = null;
        }
        active.startedAt = undefined;
        this.meta.paused = false;
        this.meta.pauseReason = undefined;
      } else if (action === 'fail_active') {
        if (!active || !options.confirmRemoteStopped) throw new HttpError(409, '请先确认远端 session 已停止且没有待处理合并或部署。');
        await this.finish(active, 'failed', '管理员确认远端已停止，已结束此任务。');
        this.meta.paused = false;
        this.meta.pauseReason = undefined;
      } else throw new HttpError(400, '未知管理操作。');
      await this.save(active, active ? `管理操作：${action}` : undefined);
    });
  }

  tick() { return this.exclusive(() => this.step()); }

  private async step() {
    if (this.meta.paused || missingConfig(this.env).length) return;
    let job = this.meta.activeId ? this.jobs.get(this.meta.activeId) : undefined;
    if (!job) {
      if (this.meta.activeId) {
        this.meta.paused = true;
        this.meta.pauseReason = '当前任务记录缺失，需管理员核对。';
        await this.save();
        return;
      }
      job = [...this.jobs.values()].filter(job => job.state === 'queued').sort((a, b) => a.number - b.number)[0];
      if (!job) return;
      this.meta.activeId = job.id;
      job.startedAt = this.date();
      job.state = 'creating';
      // Persist intent before the non-idempotent remote POST. A restarted process only reconciles it.
      await this.save(job, '开始创建 Jules session。');
      try {
        const session = await this.providers.create(job);
        const id = session.name?.match(/^sessions\/([\w-]+)$/)?.[1];
        if (!id) throw new Error('Jules 返回的 session 标识无效。');
        job.sessionId = id;
        job.sessionUrl = `https://jules.google.com/session/${id}`;
        job.sessionState = session.state;
        job.state = 'running';
        await this.save(job, 'Jules 已接收任务。');
      } catch (error) {
        if (error instanceof HttpError) {
          job.state = 'queued';
          this.meta.activeId = null;
          await this.pause(job, error.message);
        } else if (error instanceof UpstreamError && error.status >= 400 && error.status < 500 && error.status !== 408) {
          await this.finish(job, 'failed', error.message);
        } else await this.pause(job, '创建 session 的结果未确认。恢复后会先核对远端，避免重复启动。');
      }
      return;
    }

    if (job.startedAt && this.now() - Date.parse(job.startedAt) > MAX_RUNTIME) {
      await this.pause(job, '当前任务已运行超过 2 小时，保留其队列位置等待管理员检查。');
      return;
    }

    try {
      if (job.state === 'creating') {
        const session = await this.providers.reconcile(job);
        if (!session) { await this.pause(job, '未能找到对应 session。请管理员核对 Jules 后绑定 session 或结束任务。'); return; }
        const id = session.name?.match(/^sessions\/([\w-]+)$/)?.[1];
        if (!id) throw new Error('无法解析核对到的 session。');
        job.sessionId = id;
        job.sessionUrl = `https://jules.google.com/session/${id}`;
        job.state = 'running';
        await this.save(job, '已找回远端 session，继续处理。');
        return;
      }
      if (job.state === 'running' || job.state === 'needs_input') {
        const session = await this.providers.session(job.sessionId!);
        job.sessionState = session.state;
        if (session.state === 'FAILED') {
          if (this.env.DEPLOY_MODE === 'jules') await this.pause(job, 'Jules 未能完成任务，需核对是否已发布代码后再继续。');
          else await this.finish(job, 'failed', 'Jules 未能完成任务。');
          return;
        }
        if (session.state === 'AWAITING_USER_FEEDBACK') {
          job.lastAgentMessage = await this.providers.lastMessage(job.sessionId!);
          job.state = 'needs_input';
          job.message = 'Jules 正在等待需求提交者补充说明。';
        } else if (['PAUSED', 'AWAITING_PLAN_APPROVAL'].includes(session.state)) {
          await this.pause(job, `Jules 状态为 ${session.state}，需要在 Jules 中处理后恢复队列。`);
          return;
        } else if (session.state === 'COMPLETED') {
          const url = session.outputs?.find(output => output.pullRequest?.url)?.pullRequest?.url;
          if (!url) {
            if (this.env.DEPLOY_MODE === 'jules') await this.pause(job, 'Jules 已结束但没有 PR，需核对会话发布结果。');
            else await this.finish(job, 'failed', 'Jules 已结束，但没有产出可发布的 PR。');
            return;
          }
          job.prNumber = prNumberFromUrl(url, this.env);
          job.prUrl = url;
          job.state = 'checking';
          job.message = '代码已生成，等待验证通过。';
        } else if (['QUEUED', 'PLANNING', 'IN_PROGRESS'].includes(session.state)) {
          job.state = 'running';
          job.message = session.state === 'QUEUED' ? 'Jules 已接收，等待云端资源。' : session.state === 'PLANNING' ? 'Jules 正在分析需求和代码。' : 'Jules 正在实现需求。';
        } else throw new Error('Jules 返回了未识别的状态，需要管理员核对。');
        await this.save(job);
        return;
      }
      if (['checking', 'ready_to_merge', 'merging'].includes(job.state)) {
        const pr = await this.providers.pullRequest(job.prNumber!);
        const expectedRepo = `${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}`.toLowerCase();
        if (pr.base.repo.full_name.toLowerCase() !== expectedRepo || pr.head.repo?.full_name.toLowerCase() !== expectedRepo || pr.base.ref !== (this.env.GITHUB_BRANCH || 'main')) {
          throw new HttpError(409, 'PR 的源仓库或目标分支不匹配。');
        }
        if (pr.merged) {
          if (!pr.merge_commit_sha) throw new Error('合并提交尚未确认。');
          job.mergeSha = pr.merge_commit_sha;
          job.headSha = pr.head.sha;
          job.state = 'deploying';
          await this.save(job, 'PR 已合并，等待 Cloudflare 部署和健康检查。');
          return;
        }
        if (pr.state !== 'open') {
          if (this.env.DEPLOY_MODE === 'jules') await this.pause(job, 'PR 已关闭但会话可能已发布，需核对源码和线上版本。');
          else await this.finish(job, 'failed', 'PR 已关闭且未合并。');
          return;
        }
        if (pr.draft || pr.mergeable === null) return;
        if (!pr.mergeable) throw new HttpError(409, 'PR 存在合并冲突，需要修复后恢复。');
        job.headSha = pr.head.sha;
        if (await this.providers.validate(job.prNumber!, pr.head.sha) !== 'success') {
          job.state = 'checking';
          await this.save(job);
          return;
        }
        if (this.env.DEPLOY_MODE === 'jules' && await this.providers.deployment(pr.head.sha, job) !== 'success') {
          job.message = '等待确认 Jules 会话发布的版本与当前 PR 一致。';
          await this.save(job);
          return;
        }
        if (this.env.AUTO_MERGE !== 'true' && !job.mergeApproved) {
          job.state = 'ready_to_merge';
          job.message = '验证已通过，等待管理员批准合并。';
          await this.save(job);
          return;
        }
        job.state = 'merging';
        await this.save(job, '验证通过，正在合并 PR。');
        // Retry safety: the next tick checks pr.merged before attempting another merge.
        job.mergeSha = await this.providers.merge(job.prNumber!, pr.head.sha);
        job.state = 'deploying';
        await this.save(job, 'PR 已合并，等待 Cloudflare 部署和健康检查。');
        return;
      }
      if (job.state === 'deploying') {
        if (await this.providers.deployment(job.mergeSha!, job) === 'success') {
          this.meta.latestCommit = job.mergeSha;
          await this.finish(job, 'completed', '已发布到 Cloudflare，线上健康检查通过。');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理任务时遇到未知错误。';
      await this.pause(job, message);
    }
  }
}
