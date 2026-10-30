import { describe, expect, it, vi } from 'vitest';
import { LiveProviders, protectedPath, prNumberFromUrl } from '../src/control/providers';
import { jsonBody, secretMatches, textField } from '../src/control/security';
import type { Env } from '../src/control/types';

const env = { GITHUB_OWNER: 'owner', GITHUB_REPO: 'repo', GITHUB_BRANCH: 'main', DEPLOY_WORKFLOW: 'deploy.yml', GITHUB_TOKEN: 'private-value' } as Env;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

describe('release gates and API boundaries', () => {
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
