import type { Env } from './control/types';

// Application business endpoints belong here. Jules may extend this file.
// Return null to let the request continue to the frontend assets.
export async function appApi(request: Request, _env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname === '/api/app') {
    return Response.json({ name: 'noCoder', message: '应用的下一步，由大家一起决定。' });
  }
  return null;
}
