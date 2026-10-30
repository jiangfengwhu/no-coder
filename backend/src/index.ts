import { appApi } from './app';
import { digest } from './control/security';
import type { Env } from './control/types';
export { AgentQueue } from './control/queue';

const controlPath = (path: string) => path === '/api/queue' || path === '/api/requests' || path === '/api/admin' || /^\/api\/requests\/[\w-]+\/feedback$/.test(path);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, commit: env.APP_COMMIT || 'local', tree: env.APP_TREE || '', jobId: env.APP_JOB || '' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (controlPath(url.pathname)) {
      if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) {
        return Response.json({ error: '请从本站页面提交请求。' }, { status: 403 });
      }
      const existing = request.headers.get('Cookie')?.match(/(?:^|;\s*)nc_visitor=([a-f0-9]{64})(?:;|$)/)?.[1];
      const token = existing ?? Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
      const headers = new Headers(request.headers);
      headers.set('X-Visitor-Hash', await digest(token));
      headers.set('X-IP-Hash', await digest(request.headers.get('CF-Connecting-IP') ?? 'local'));
      const stub = env.AGENT_QUEUE.get(env.AGENT_QUEUE.idFromName('global-v1'));
      const upstream = await stub.fetch(new Request(request, { headers }));
      const response = new Response(upstream.body, upstream);
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      if (!existing) response.headers.append('Set-Cookie', `nc_visitor=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${url.protocol === 'https:' ? '; Secure' : ''}`);
      return response;
    }
    const businessResponse = await appApi(request, env);
    if (businessResponse) return businessResponse;
    if (url.pathname.startsWith('/api/')) return Response.json({ error: '接口不存在。' }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
