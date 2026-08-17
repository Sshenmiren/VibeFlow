import type {
  AiSettings, Blueprint, BusinessViews, ChangeSet, ImpactResult, NodeExplanation,
  ProjectMeta, ServerEvent, TechGraph, TimelineEvent, ViewLayouts,
} from '../../shared/types.ts';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `请求失败 ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  registry: () => req<{ id: string; path: string; name: string }[]>('/api/registry'),
  importProject: (path: string) => req<ProjectMeta>('/api/projects', { method: 'POST', body: JSON.stringify({ path }) }),
  project: (id: string) => req<ProjectMeta>(`/api/projects/${id}`),
  reanalyze: (id: string) => req<ProjectMeta>(`/api/projects/${id}/reanalyze`, { method: 'POST' }),
  graph: (id: string) => req<TechGraph>(`/api/projects/${id}/graph`),
  views: (id: string) => req<BusinessViews | null>(`/api/projects/${id}/views`),
  generateViews: (id: string) => req<BusinessViews>(`/api/projects/${id}/views/generate`, { method: 'POST' }),
  explanation: (id: string, nodeId: string) =>
    req<NodeExplanation>(`/api/projects/${id}/nodes/${encodeURIComponent(nodeId)}/explanation`),
  explainAll: (id: string, kind: string) =>
    req<{ generated: number; cached: number }>(`/api/projects/${id}/views/${kind}/explain-all`, { method: 'POST' }),
  ask: (id: string, nodeId: string, question: string) =>
    req<{ answer: string; costUsd: number }>(`/api/projects/${id}/nodes/${encodeURIComponent(nodeId)}/ask`, {
      method: 'POST', body: JSON.stringify({ question }),
    }),
  impact: (id: string, nodeId: string) =>
    req<ImpactResult>(`/api/projects/${id}/impact/${encodeURIComponent(nodeId)}`),
  file: (id: string, path: string) =>
    req<{ path: string; content: string }>(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`),
  timeline: (id: string) => req<TimelineEvent[]>(`/api/projects/${id}/timeline`),
  changesets: (id: string) => req<ChangeSet[]>(`/api/projects/${id}/changesets`),
  createModify: (id: string, nodeId: string, instruction: string) =>
    req<ChangeSet>(`/api/projects/${id}/nodes/${encodeURIComponent(nodeId)}/modify`, {
      method: 'POST', body: JSON.stringify({ instruction }),
    }),
  executeChangeSet: (id: string, csId: string) =>
    req<{ started: true }>(`/api/projects/${id}/changesets/${csId}/execute`, { method: 'POST' }),
  acceptChangeSet: (id: string, csId: string) =>
    req<ChangeSet>(`/api/projects/${id}/changesets/${csId}/accept`, { method: 'POST' }),
  rollbackChangeSet: (id: string, csId: string) =>
    req<ChangeSet>(`/api/projects/${id}/changesets/${csId}/rollback`, { method: 'POST' }),
  snapshot: (id: string) => req<{ ok: true }>(`/api/projects/${id}/snapshot`, { method: 'POST' }),
  layout: (id: string) => req<ViewLayouts>(`/api/projects/${id}/layout`),
  saveLayout: (id: string, view: string, positions: Record<string, { x: number; y: number }>) =>
    req<{ ok: true }>(`/api/projects/${id}/layout`, { method: 'PUT', body: JSON.stringify({ view, positions }) }),
  blueprint: (id: string) => req<Blueprint>(`/api/projects/${id}/blueprint`),
  saveBlueprint: (id: string, b: Omit<Blueprint, 'updatedAt'>) =>
    req<{ ok: true }>(`/api/projects/${id}/blueprint`, { method: 'PUT', body: JSON.stringify(b) }),
  sendBlueprint: (id: string) => req<ChangeSet>(`/api/projects/${id}/blueprint/send`, { method: 'POST' }),
  settings: () => req<AiSettings>('/api/settings'),
  saveSettings: (s: Partial<AiSettings>) => req<AiSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
};

/** 订阅项目事件流，返回取消函数 */
export function subscribeEvents(projectId: string, onEvent: (e: ServerEvent) => void): () => void {
  const source = new EventSource(`/api/projects/${projectId}/events`);
  source.onmessage = (msg) => {
    try { onEvent(JSON.parse(msg.data as string) as ServerEvent); } catch { /* 忽略坏包 */ }
  };
  return () => source.close();
}
