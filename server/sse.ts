import type { Response } from 'express';
import type { ServerEvent } from '../shared/types.ts';

/** 极简 SSE hub：每个项目一组订阅者 */
const subscribers = new Map<string, Set<Response>>();

export function subscribe(projectId: string, res: Response) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  if (!subscribers.has(projectId)) subscribers.set(projectId, new Set());
  subscribers.get(projectId)!.add(res);
  const keepalive = setInterval(() => res.write(': ping\n\n'), 25_000);
  res.on('close', () => {
    clearInterval(keepalive);
    subscribers.get(projectId)?.delete(res);
  });
}

export function emit(event: ServerEvent) {
  const subs = subscribers.get(event.projectId);
  if (!subs) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of subs) res.write(payload);
}
