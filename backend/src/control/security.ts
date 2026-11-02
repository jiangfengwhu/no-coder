import { configuredValue, HttpError, type Env } from './types';

export function redactCoordinatorContext(env: Env, text: string): string {
  for (const secret of [env.JULES_API_KEY, env.GITHUB_TOKEN, env.QUEUE_ADMIN_TOKEN, env.CLOUDFLARE_API_TOKEN, env.SUBMISSION_TOKEN]) {
    if (secret && secret.length > 8) text = text.split(secret).join('[redacted]');
  }
  return text.replace(/NC_DEPLOY_TOKEN\s*=\s*[^\s"'<>\\]+/gi, 'NC_DEPLOY_TOKEN=[redacted]').replace(/Bearer\s+[a-z0-9._-]+/gi, 'Bearer [redacted]');
}

export async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function secretMatches(provided: string, expected?: string): Promise<boolean> {
  if (!configuredValue(expected) || !provided) return false;
  const [left, right] = await Promise.all([digest(provided), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

export async function deploymentLease(jobId: string, adminSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(adminSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`nocoder-deploy:${jobId}`));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, '请使用 JSON 提交。');
  if (Number(request.headers.get('Content-Length')) > 20_000) throw new HttpError(413, '提交内容过长。');
  if (!request.body) throw new HttpError(400, '提交内容为空。');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 20_000) { await reader.cancel(); throw new HttpError(413, '提交内容过长。'); }
    chunks.push(value);
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new HttpError(400, '提交的 JSON 格式无效。'); }
}

export function textField(input: Record<string, unknown>, key: string, min: number, max: number): string {
  const value = input[key];
  if (value === undefined && min === 0) return '';
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new HttpError(400, `${key} 的长度应为 ${min}–${max} 个字符。`);
  }
  return value.trim();
}
