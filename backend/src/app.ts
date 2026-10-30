import type { Env } from './control/types';

interface Message {
  id: string;
  content: string;
  createdAt: string;
}

const messages: Message[] = [];

// Application business endpoints belong here. Jules may extend this file.
// Return null to let the request continue to the frontend assets.
export async function appApi(request: Request, _env: Env): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === '/api/app') {
    return Response.json({ name: 'noCoder', message: '应用的下一步，由大家一起决定。' });
  }

  if (url.pathname === '/api/messages') {
    if (request.method === 'GET') {
      // Return messages in reverse chronological order
      return Response.json([...messages].reverse());
    }

    if (request.method === 'POST') {
      const data = await request.json() as { content: string };
      const content = data.content?.trim();

      if (!content) {
        return Response.json({ error: '留言内容不能为空' }, { status: 400 });
      }

      const newMessage: Message = {
        id: crypto.randomUUID(),
        content,
        createdAt: new Date().toISOString(),
      };

      messages.push(newMessage);
      return Response.json(newMessage, { status: 201 });
    }
  }

  return null;
}
