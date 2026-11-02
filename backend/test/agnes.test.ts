import { describe, it, expect, vi } from 'vitest';
import { agnesAdvice } from '../src/control/agnes';
import type { Env } from '../src/control/types';
describe('Agnes coordinator', () => {
  const env = { AGNES_API_KEY: 'test-agnes-secret', QUEUE_ADMIN_TOKEN: 'test-admin-secret' } as Env;
  it('uses structured responses and never supplies deployment secrets to the model', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"action":"reply","message":"使用现有组件实现交互"}' } }] }));
    expect(await agnesAdvice(env, 'feedback', { question: 'token test-admin-secret NC_DEPLOY_TOKEN=abcdef123456' }, fetcher as typeof fetch)).toMatchObject({ action: 'reply' });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.model).toBe('agnes-3.0-flash');
    expect(body.messages[1].content).not.toContain('test-admin-secret');
    expect(body.messages[1].content).not.toContain('abcdef123456');
  });
  it('rejects invalid responses and handles unavailable services without exposing upstream bodies', async () => {
    const malformed = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: 'not JSON' } }] }));
    await expect(agnesAdvice(env, 'brief', {}, malformed as typeof fetch)).rejects.toMatchObject({ status: 503 });
    const failed = vi.fn().mockResolvedValue(new Response('private upstream details', { status: 401 }));
    await expect(agnesAdvice(env, 'brief', {}, failed as typeof fetch)).rejects.toThrow('HTTP 401');
    expect(await agnesAdvice({} as Env, 'brief', {})).toBeNull();
  });
});
