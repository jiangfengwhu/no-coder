import { describe, expect, it, vi } from 'vitest';
import { LiveProviders, protectedPath, prNumberFromUrl } from '../src/control/providers';
import { jsonBody, secretMatches, textField } from '../src/control/security';
import type { Env, Job } from '../src/control/types';

const env = { GITHUB_OWNER: 'owner', GITHUB_REPO: 'repo', GITHUB_BRANCH: 'main', JULES_SOURCE: 'sources/test', QUEUE_ADMIN_TOKEN: 'test-admin', DEPLOY_WORKFLOW: 'deploy.yml', GITHUB_TOKEN: 'private-value' } as Env;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

describe('release gates and API boundaries', () => {
  it('binds the default native fetch receiver to the Worker global', async () => {
    const nativeLikeFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(json({ number: 42 }));
    });
    vi.stubGlobal('fetch', nativeLikeFetch);
    try {
      await expect(new LiveProviders(env).pullRequest(42)).resolves.toMatchObject({ number: 42 });
      expect(nativeLikeFetch).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
  it('instructs Jules to build and deploy directly in its session', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ name: 'sessions/test', state: 'QUEUED' }));
    const providers = new LiveProviders({ ...env, DEPLOY_MODE: 'jules' }, fetcher as typeof fetch);
    await providers.create({ id: 'task-id', title: '增加留言板', description: '公开留言', acceptance: '' } as Job);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.prompt).toContain('NC_JOB_ID=task-id');
    expect(body.prompt).toContain('npm run deploy:jules');
    expect(body.prompt).toContain('NC_DEPLOY_TOKEN=');
    expect(body.prompt).not.toContain('不要自行合并或部署');
    expect(body.automationMode).toBe('AUTO_CREATE_PR');
  });

  it('discovers the repository source automatically across pages', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/sessions')) return json({ name: 'sessions/test', state: 'QUEUED' });
      if (url.includes('pageToken=next')) return json({ sources: [{ name: 'sources/actual-repo', githubRepo: { owner: 'owner', repo: 'repo' } }] });
      return json({ sources: [{ name: 'sources/another-repo', githubRepo: { owner: 'owner', repo: 'another' } }], nextPageToken: 'next' });
    });
    await new LiveProviders({ ...env, JULES_SOURCE: undefined, DEPLOY_MODE: 'jules' }, fetcher as typeof fetch).create({ id: 'job-id', title: '任务', description: '内容', acceptance: '' } as Job);
    const body = JSON.parse(fetcher.mock.calls.at(-1)![1].body);
    expect(body.sourceContext.source).toBe('sources/actual-repo');
  });

  it('accepts a Jules deployment only for the same source tree and active task marker', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => url.includes('api.github.com') ? json({ tree: { sha: 'tree-sha' } }) : json({ ok: true, commit: 'a'.repeat(40), tree: 'tree-sha', jobId: 'current-job' }));
    const providers = new LiveProviders({ ...env, DEPLOY_MODE: 'jules', APP_URL: 'https://app.test' }, fetcher as typeof fetch);
    const job = { headSha: 'pr-sha', id: 'current-job' } as Job;
    expect(await providers.deployment('merged-sha', job)).toBe('success');
    expect(await providers.deployment('merged-sha', { ...job, id: 'other-job' })).toBe('pending');
  });

  it('blocks mismatched merged and deployed source trees', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => json({ tree: { sha: url.endsWith('/merged-sha') ? 'merged-tree' : 'pr-tree' } }));
    const providers = new LiveProviders({ ...env, DEPLOY_MODE: 'jules' }, fetcher as typeof fetch);
    await expect(providers.deployment('merged-sha', { headSha: 'pr-sha', id: 'job' } as Job)).rejects.toThrow('源码');
  });

  it('rejects PR URLs from a different repository or host', () => {
    expect(prNumberFromUrl('https://github.com/owner/repo/pull/123', env)).toBe(123);
    expect(() => prNumberFromUrl('https://github.com/attacker/repo/pull/123', env)).toThrow();
    expect(() => prNumberFromUrl('https://github.com.evil.test/owner/repo/pull/123', env)).toThrow();
  });

  it('protects scheduler and workflows while allowing application code', () => {
    expect(protectedPath('backend/src/control/queue.ts')).toBe(true);
    expect(protectedPath('.github/workflows/deploy.yml')).toBe(true);
    expect(protectedPath('backend/src/app.ts')).toBe(false);
    expect(protectedPath('frontend/src/main.tsx')).toBe(false);
  });

  it('does not interpret zero checks as a successful validation', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => url.includes('/files?') ? json([]) : url.includes('/check-runs?') ? json({ total_count: 0, check_runs: [] }) : json({ total_count: 0, state: 'pending' }));
    expect(await new LiveProviders(env, fetcher as typeof fetch).validate(1, 'abc')).toBe('pending');
  });

  it('blocks a rename of protected infrastructure', async () => {
    const fetcher = vi.fn().mockResolvedValue(json([{ filename: 'frontend/moved.ts', previous_filename: 'backend/src/control/queue.ts' }]));
    await expect(new LiveProviders(env, fetcher as typeof fetch).validate(1, 'abc')).rejects.toThrow('基础设施');
  });

  it('accepts only a successful GitHub Actions validate check', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => url.includes('/files?') ? json([]) : url.includes('/check-runs?') ? json({ total_count: 1, check_runs: [{ name: 'validate', status: 'completed', conclusion: 'success', app: { slug: 'github-actions' } }] }) : json({ total_count: 0, state: 'pending' }));
    expect(await new LiveProviders(env, fetcher as typeof fetch).validate(1, 'abc')).toBe('success');
  });

  it('tracks the configured deployment workflow and exact commit', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ workflow_runs: [{ head_sha: 'new-sha', head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }] }));
    expect(await new LiveProviders(env, fetcher as typeof fetch).deployment('new-sha')).toBe('success');
    expect(fetcher.mock.calls[0][0]).toContain('workflows/deploy.yml/runs?head_sha=new-sha');
  });

  it('compares secrets and rejects oversized or malformed request bodies', async () => {
    expect(await secretMatches('right', 'right')).toBe(true);
    expect(await secretMatches('wrong', 'right')).toBe(false);
    expect(await secretMatches('', '')).toBe(false);
    expect(() => textField({ title: 'a' }, 'title', 2, 100)).toThrow();
    const headers = { 'Content-Type': 'application/json' };
    await expect(jsonBody(new Request('https://test', { method: 'POST', headers, body: '[]' }))).rejects.toThrow('JSON');
    await expect(jsonBody(new Request('https://test', { method: 'POST', headers, body: JSON.stringify({ text: 'a'.repeat(21_000) }) }))).rejects.toMatchObject({ status: 413 });
  });
});
