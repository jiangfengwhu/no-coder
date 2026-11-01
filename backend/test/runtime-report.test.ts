import { describe, expect, it } from 'vitest';
import { runtimeReport } from '../src/control/runtime-report';
describe('runtime report sanitization', () => {
  it('rejects invalid version identities and removes quoted data, tokens and URL queries', () => {
    expect(() => runtimeReport({})).toThrow();
    const result = runtimeReport({ tree: 'a'.repeat(40), jobId: '12345678-1234-1234-1234-123456789abc', message: 'Error "private text" token abcdefghijklmnopqrstuvwxyz123456 https://example.com/app.js?secret=abc', location: 'https://example.com/app.js?token=abc' });
    expect(result.message).not.toContain('private text');
    expect(result.message).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(result.message).not.toContain('secret=');
    expect(result.location).toBe('/app.js');
  });
});
