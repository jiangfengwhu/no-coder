import { describe, expect, it, vi } from 'vitest';
import { deploymentOptions, verifyLive } from '../../scripts/deploy-jules.mjs';

describe('Jules deployment script', () => {
  it('requires a token for unattended production uploads', () => {
    expect(() => deploymentOptions({})).toThrow('CLOUDFLARE_API_TOKEN');
    expect(deploymentOptions({}, ['--dry-run']).dryRun).toBe(true);
    expect(deploymentOptions({}, ['--local-auth']).localAuth).toBe(true);
  });

  it('rejects malformed or credential-bearing URLs and task IDs', () => {
    for (const APP_URL of ['http://example.test', 'https://user:password@example.test', 'https://example.test/path', 'https://example.test/?token=secret']) {
      expect(() => deploymentOptions({ APP_URL }, ['--dry-run'])).toThrow();
    }
    expect(() => deploymentOptions({ NC_JOB_ID: 'not-a-job' }, ['--dry-run'])).toThrow('NC_JOB_ID');
  });

  it('requires the exact commit, tree and task marker for script success', async () => {
    const expected = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), jobId: 'current-job' };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, ...expected })));
    expect(await verifyLive('https://example.test', expected, fetcher)).toBe(true);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ ok: true, ...expected, tree: 'wrong-tree' })));
    expect(await verifyLive('https://example.test', expected, fetcher)).toBe(false);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ ok: true, ...expected, jobId: 'another-job' })));
    expect(await verifyLive('https://example.test', expected, fetcher)).toBe(false);
  });
});
