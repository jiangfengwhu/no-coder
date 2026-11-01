import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueEngine } from '../src/control/engine';
import { missingConfig, type Env, type Job, type QueueMeta, type QueueStore } from '../src/control/types';
import { deploymentLease } from '../src/control/security';
import type { Providers } from '../src/control/providers';

class MemoryStore implements QueueStore {
  meta?: QueueMeta;
  jobs = new Map<string, Job>();
  async loadMeta() { return structuredClone(this.meta); }
  async listJobs() { return structuredClone([...this.jobs.values()]); }
  async save(meta: QueueMeta, job?: Job) {
    this.meta = structuredClone(meta);
    if (job) this.jobs.set(job.id, structuredClone(job));
  }
}

const config = {
  JULES_API_KEY: 'test-key', GITHUB_TOKEN: 'test-token', QUEUE_ADMIN_TOKEN: 'test-admin',
  GITHUB_OWNER: 'owner', GITHUB_REPO: 'repo', GITHUB_BRANCH: 'main', JULES_SOURCE: 'sources/test', AUTO_MERGE: 'true', CLOUDFLARE_API_TOKEN: 'test-cloudflare-token',
} as Env;

describe('durable serial queue', () => {
  let store: MemoryStore;
  let provider: Providers;
  let engine: QueueEngine;
  let clock: number;
  let sequence: number;

  const submit = (owner = 'owner-a') => engine.submit({ title: '添加留言板', description: '任何人都可以发表留言，刷新后保留。', acceptance: '刷新仍有留言', requestId: `request-0000000-${++sequence}` }, owner, 'ip-hash');
  const completeGeneration = () => {
    vi.mocked(provider.session).mockResolvedValue({ name: 'sessions/remote-1', state: 'COMPLETED', outputs: [{ pullRequest: { url: 'https://github.com/owner/repo/pull/42' } }] });
  };

  beforeEach(() => {
    store = new MemoryStore(); clock = Date.parse('2026-10-30T08:00:00Z'); sequence = 0;
    provider = {
      create: vi.fn().mockResolvedValue({ name: 'sessions/remote-1', state: 'QUEUED' }),
      reconcile: vi.fn().mockResolvedValue(undefined),
      session: vi.fn().mockResolvedValue({ name: 'sessions/remote-1', state: 'IN_PROGRESS' }),
      message: vi.fn().mockResolvedValue(undefined), lastMessage: vi.fn().mockResolvedValue('需要支持哪些字段？'),
      pullRequest: vi.fn().mockResolvedValue({ number: 42, state: 'open', merged: false, merge_commit_sha: null,
        head: { sha: 'head-sha', repo: { full_name: 'owner/repo' } }, base: { ref: 'main', repo: { full_name: 'owner/repo' } }, mergeable: true, draft: false }),
      validate: vi.fn().mockResolvedValue('success'), merge: vi.fn().mockResolvedValue('merged-sha'), deployment: vi.fn().mockResolvedValue('pending'),
    };
    engine = new QueueEngine(store, provider, config, () => clock);
  });

  it('keeps placeholder secrets unconfigured without requiring a manual Jules source', () => {
    const missing = missingConfig({ ...config, DEPLOY_MODE: 'jules', JULES_SOURCE: undefined, JULES_API_KEY: 'REPLACE_WITH_JULES_API_KEY', CLOUDFLARE_API_TOKEN: 'REPLACE_WITH_CLOUDFLARE_API_TOKEN' });
    expect(missing).toContain('JULES_API_KEY');
    expect(missing).toContain('CLOUDFLARE_API_TOKEN');
    expect(missing).not.toContain('JULES_SOURCE');
  });

  it('only supplies credentials to the authorized active task and refuses paused tasks', async () => {
    engine = new QueueEngine(store, provider, { ...config, DEPLOY_MODE: 'jules' }, () => clock);
    const active = await submit();
    const waiting = await submit('owner-b');
    await engine.tick();
    const token = await deploymentLease(active, config.QUEUE_ADMIN_TOKEN!);
    await expect(engine.deploymentCredentials(active, 'wrong-token')).rejects.toMatchObject({ status: 403 });
    await expect(engine.deploymentCredentials(waiting, token)).rejects.toMatchObject({ status: 403 });
    expect((await engine.deploymentCredentials(active, token)).apiToken).toBe('test-cloudflare-token');
    expect(JSON.stringify(await engine.view(''))).not.toContain('test-cloudflare-token');
    expect(JSON.stringify(await engine.view(''))).not.toContain(token);
    await engine.admin('pause');
    await expect(engine.deploymentCredentials(active, token)).rejects.toMatchObject({ status: 403 });
  });

  it('serializes simultaneous ticks and keeps FIFO order', async () => {
    const first = await submit();
    const second = await submit('owner-b');
    await Promise.all([engine.tick(), engine.tick(), engine.tick()]);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(engine.meta.activeId).toBe(first);
    expect((await engine.view('owner-b')).jobs.find(job => job.id === second)?.position).toBe(1);
  });

  it('creates one serial creative task, prioritizes queued users, and enforces the Shanghai daily limit', async () => {
    engine = new QueueEngine(store, provider, { ...config, AUTO_CREATIVE: 'true' }, () => clock);
    const userId = await submit();
    await engine.tick();
    expect(engine.meta.activeId).toBe(userId);
    expect(engine.meta.autoCount).toBeUndefined();
    await engine.admin('pause');
    await engine.admin('fail_active', { confirmRemoteStopped: true });
    await engine.tick();
    expect(engine.meta.autoCount).toBe(1);
    expect(engine.jobs.get(engine.meta.activeId!)?.ownerHash).toBe('system:creative');
    expect(provider.create).toHaveBeenCalledTimes(2);
    await engine.admin('fail_active', { confirmRemoteStopped: true });
    engine.meta.autoCount = 70;
    await engine.tick();
    expect(provider.create).toHaveBeenCalledTimes(2);
    clock += 86_400_000;
    await engine.tick();
    expect(provider.create).toHaveBeenCalledTimes(3);
    expect(engine.meta.autoCount).toBe(1);
  });

  it('waits for Jules live deployment before merging and starting the next session', async () => {
    engine = new QueueEngine(store, provider, { ...config, DEPLOY_MODE: 'jules' }, () => clock);
    const id = await submit(); await submit('owner-b'); await engine.tick();
    completeGeneration(); await engine.tick(); await engine.tick();
    expect(provider.merge).not.toHaveBeenCalled();
    expect(engine.meta.activeId).toBe(id);
    vi.mocked(provider.deployment).mockResolvedValue('success');
    await engine.tick(); expect(provider.merge).toHaveBeenCalledOnce();
    await engine.tick(); expect(engine.jobs.get(id)?.state).toBe('completed');
    await engine.tick(); expect(provider.create).toHaveBeenCalledTimes(2);
  });

  it('retains the slot on Jules failure in direct deployment mode', async () => {
    engine = new QueueEngine(store, provider, { ...config, DEPLOY_MODE: 'jules' }, () => clock);
    const id = await submit(); await engine.tick();
    vi.mocked(provider.session).mockResolvedValue({ name: 'sessions/remote-1', state: 'FAILED' });
    await engine.tick();
    expect(engine.meta.paused).toBe(true);
    expect(engine.meta.activeId).toBe(id);
    expect(engine.jobs.get(id)?.state).not.toBe('failed');
  });

  it('does not release the slot until generation, merge and deployment all finish', async () => {
    const first = await submit(); await submit('owner-b');
    await engine.tick(); completeGeneration(); await engine.tick();
    expect(engine.jobs.get(first)?.state).toBe('checking');
    await engine.tick(); expect(engine.jobs.get(first)?.state).toBe('deploying');
    await engine.tick(); expect(provider.create).toHaveBeenCalledTimes(1);
    vi.mocked(provider.deployment).mockResolvedValue('success');
    await engine.tick(); expect(engine.jobs.get(first)?.state).toBe('completed');
    expect(engine.meta.activeId).toBeNull();
    await engine.tick(); expect(provider.create).toHaveBeenCalledTimes(2);
    expect(engine.meta.latestCommit).toBe('merged-sha');
  });

  it('recovers active state from storage after process restart', async () => {
    const first = await submit(); await engine.tick(); await submit('owner-b');
    const restarted = new QueueEngine(store, provider, config, () => clock);
    await restarted.tick();
    expect(restarted.meta.activeId).toBe(first);
    expect(provider.create).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite storage or notify subscribers for unchanged upstream state', async () => {
    const changed = vi.fn();
    engine = new QueueEngine(store, provider, config, () => clock, changed);
    await submit(); await engine.tick(); await engine.tick();
    const write = vi.spyOn(store, 'save');
    const notifications = changed.mock.calls.length;
    clock += 60_000;
    await engine.tick();
    expect(write).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(notifications);
  });

  it('deduplicates retried submissions, and does not leak ownership tokens', async () => {
    const body = { title: '测试需求', description: '这是用于验证提交幂等性的需求。', acceptance: '', requestId: 'request-0000000001' };
    const ids = await Promise.all([engine.submit(body, 'secret-owner', 'ip'), engine.submit(body, 'secret-owner', 'ip')]);
    expect(ids[0]).toBe(ids[1]);
    const view = await engine.view('someone-else');
    expect(view.jobs).toHaveLength(1);
    expect(view.jobs[0].mine).toBe(false);
    expect(JSON.stringify(view)).not.toContain('secret-owner');
    expect(JSON.stringify(view)).not.toContain('request-0000000001');
  });

  it('stores requests without credentials and never pretends to start Jules', async () => {
    engine = new QueueEngine(store, provider, { ...config, JULES_API_KEY: '' }, () => clock);
    await submit(); await engine.tick();
    expect(provider.create).not.toHaveBeenCalled();
    expect((await engine.view('')).configured).toBe(false);
  });

  it('retains its slot while waiting for the original submitter to reply', async () => {
    const id = await submit(); await submit('owner-b'); await engine.tick();
    vi.mocked(provider.session).mockResolvedValue({ name: 'sessions/remote-1', state: 'AWAITING_USER_FEEDBACK' });
    await engine.tick();
    expect(engine.jobs.get(id)?.state).toBe('needs_input');
    expect(engine.meta.activeId).toBe(id);
    await expect(engine.feedback(id, 'owner-b', '支持标题和内容')).rejects.toMatchObject({ status: 403 });
    await engine.feedback(id, 'owner-a', '支持标题和内容');
    expect(provider.message).toHaveBeenCalledWith('remote-1', '支持标题和内容');
    expect(engine.jobs.get(id)?.state).toBe('running');
    expect(provider.create).toHaveBeenCalledTimes(1);
  });

  it('never blindly retries session creation after an ambiguous network failure', async () => {
    const id = await submit(); await submit('owner-b');
    vi.mocked(provider.create).mockRejectedValue(new TypeError('network timeout'));
    await engine.tick();
    expect(engine.meta.paused).toBe(true);
    expect(store.jobs.get(id)?.state).toBe('creating');
    await engine.admin('resume'); await engine.tick();
    expect(provider.reconcile).toHaveBeenCalledOnce();
    expect(provider.create).toHaveBeenCalledOnce();
    expect(engine.meta.activeId).toBe(id);
    expect(engine.meta.paused).toBe(true);
  });

  it('retries the original task only after an administrator confirms remote absence', async () => {
    const id = await submit();
    vi.mocked(provider.create).mockRejectedValueOnce(new TypeError('lost response'));
    await engine.tick();
    await engine.admin('retry_active');
    expect(provider.reconcile).toHaveBeenCalledOnce();
    expect(engine.jobs.get(id)?.state).toBe('queued');
    expect(engine.meta.paused).toBe(false);
    await engine.tick();
    expect(provider.create).toHaveBeenCalledTimes(2);
    expect(engine.meta.activeId).toBe(id);
    expect(engine.jobs.size).toBe(1);
  });

  it('reuses an existing remote session instead of creating another on retry', async () => {
    const id = await submit();
    vi.mocked(provider.create).mockRejectedValueOnce(new TypeError('lost response'));
    await engine.tick();
    vi.mocked(provider.reconcile).mockResolvedValue({ name: 'sessions/existing', state: 'IN_PROGRESS' });
    await engine.admin('retry_active');
    expect(engine.jobs.get(id)?.sessionId).toBe('existing');
    expect(engine.jobs.get(id)?.state).toBe('running');
    expect(provider.create).toHaveBeenCalledOnce();
  });

  it('finds a remotely created session after losing the original response', async () => {
    const id = await submit();
    vi.mocked(provider.create).mockRejectedValue(new TypeError('connection reset'));
    await engine.tick();
    vi.mocked(provider.reconcile).mockResolvedValue({ name: 'sessions/recovered', state: 'IN_PROGRESS' });
    await engine.admin('resume'); await engine.tick();
    expect(engine.jobs.get(id)?.sessionId).toBe('recovered');
    expect(engine.jobs.get(id)?.state).toBe('running');
    expect(provider.create).toHaveBeenCalledOnce();
  });

  it('pauses on failed validation without starting the next request', async () => {
    const id = await submit(); await submit('owner-b'); await engine.tick();
    completeGeneration(); await engine.tick();
    vi.mocked(provider.validate).mockRejectedValue(new Error('CI failed'));
    await engine.tick(); await engine.tick();
    expect(engine.meta.paused).toBe(true);
    expect(engine.meta.activeId).toBe(id);
    expect(provider.merge).not.toHaveBeenCalled();
    expect(provider.create).toHaveBeenCalledOnce();
  });

  it('checks whether an ambiguous merge actually succeeded before retrying it', async () => {
    const id = await submit(); await engine.tick(); completeGeneration(); await engine.tick();
    vi.mocked(provider.merge).mockRejectedValue(new TypeError('lost response'));
    await engine.tick(); expect(engine.meta.paused).toBe(true);
    vi.mocked(provider.pullRequest).mockResolvedValue({ ...(await provider.pullRequest(42)), merged: true, merge_commit_sha: 'actual-merge' });
    await engine.admin('resume'); await engine.tick();
    expect(engine.jobs.get(id)?.mergeSha).toBe('actual-merge');
    expect(engine.jobs.get(id)?.state).toBe('deploying');
    expect(provider.merge).toHaveBeenCalledOnce();
  });

  it('pauses on deployment failure and retains the active request', async () => {
    const id = await submit(); await engine.tick(); completeGeneration(); await engine.tick(); await engine.tick();
    vi.mocked(provider.deployment).mockRejectedValue(new Error('deploy failed'));
    await engine.tick();
    expect(engine.meta.activeId).toBe(id);
    expect(engine.meta.paused).toBe(true);
  });

  it('records explicit Jules failure and allows the next request', async () => {
    const id = await submit(); await submit('owner-b'); await engine.tick();
    vi.mocked(provider.session).mockResolvedValue({ name: 'sessions/remote-1', state: 'FAILED' });
    await engine.tick(); expect(engine.jobs.get(id)?.state).toBe('failed');
    await engine.tick(); expect(provider.create).toHaveBeenCalledTimes(2);
  });

  it('pauses overdue work without freeing a possibly running remote session', async () => {
    const id = await submit(); await engine.tick();
    clock += 2 * 60 * 60 * 1000 + 1; await engine.tick();
    expect(engine.meta.paused).toBe(true);
    expect(engine.meta.activeId).toBe(id);
  });

  it('revalidates PRs when optional manual merge approval is enabled', async () => {
    engine = new QueueEngine(store, provider, { ...config, AUTO_MERGE: 'false' }, () => clock);
    const id = await submit(); await engine.tick(); completeGeneration(); await engine.tick(); await engine.tick();
    expect(engine.jobs.get(id)?.state).toBe('ready_to_merge');
    expect(provider.merge).not.toHaveBeenCalled();
    await engine.admin('approve_merge'); await engine.tick();
    expect(provider.validate).toHaveBeenCalledTimes(2);
    expect(provider.merge).toHaveBeenCalledWith(42, 'head-sha');
  });
});
