import { describe, expect, it, vi } from 'vitest';
import { checkTokens } from '../src/control/diagnostics';
import type { Env } from '../src/control/types';

describe('token diagnostics', () => {
  const env = { JULES_API_KEY: 'secret-jules', GITHUB_TOKEN: 'secret-github', CLOUDFLARE_API_TOKEN: 'secret-cloudflare', GITHUB_OWNER: 'owner', GITHUB_REPO: 'repo', GITHUB_BRANCH: 'main' } as Env;
  it('only makes GET requests and never returns tokens or upstream error messages', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: 'contains-secret-cloudflare', token: 'secret-jules' }), { status: 401 }));
    const report = await checkTokens(env, fetcher as typeof fetch);
    expect(report.jules.valid).toBe(false);
    expect(report.github.valid).toBe(false);
    expect(report.cloudflare.valid).toBe(false);
    expect(JSON.stringify(report)).not.toContain('secret-');
    expect(fetcher.mock.calls.every(([, init]) => !init.method || init.method === 'GET')).toBe(true);
  });
  it('does not send placeholder values upstream', async () => {
    const fetcher = vi.fn();
    const report = await checkTokens({ ...env, JULES_API_KEY: 'REPLACE_WITH_JULES_API_KEY', GITHUB_TOKEN: '', CLOUDFLARE_API_TOKEN: '' }, fetcher as typeof fetch);
    expect(fetcher).not.toHaveBeenCalled();
    expect(report.jules.configured).toBe(false);
  });
  it('recognizes account-owned Cloudflare tokens without claiming missing Worker permissions', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => url.endsWith('/accounts/9f38af437152e2268766afd8fdb6cf72/tokens/verify')
      ? new Response(JSON.stringify({ success: true, result: { status: 'active' } }))
      : new Response('{}', { status: 403 }));
    const report = await checkTokens(env, fetcher as typeof fetch);
    expect(report.cloudflare.valid).toBe(true);
    expect(report.cloudflare.tokenType).toBe('account');
    expect(report.cloudflare.workerSettingsStatus).toBe(403);
    expect(report.cloudflare.writeTested).toBe(false);
  });
});
