import { HttpError } from './types';

export function runtimeReport(body: Record<string, unknown>) {
  if (typeof body.tree !== 'string' || !/^[a-f0-9]{40}$/.test(body.tree) || typeof body.jobId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.jobId)) throw new HttpError(400, '发布标识无效。');
  const clean = (value: unknown) => String(value ?? '').replace(/https?:\/\/[^\s)]+/g, url => { try { return new URL(url).pathname; } catch { return '[url]'; } }).replace(/(["'`]).*?\1/g, '[text]').replace(/\b[A-Za-z0-9_\-]{24,}\b/g, '[redacted]').slice(0, 500);
  const kind = ['ready', 'error', 'unhandledrejection', 'resource'].includes(String(body.kind)) ? String(body.kind) : 'error';
  return { tree: body.tree, jobId: body.jobId, kind, message: clean(body.message), location: clean(body.location) };
}
