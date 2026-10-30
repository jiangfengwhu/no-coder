import type { QueueView } from '../../backend/src/control/types';

export async function api<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({ error: '服务暂时不可用，请稍后再试。' })) as { error?: string };
    throw new Error(result.error || `请求失败（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

export const loadQueue = () => api<QueueView>('/api/queue');
