import fs from 'node:fs';
import path from 'node:path';
import type { BizNode, SourceRef, SymbolFact, ViewKind } from '../shared/types.ts';
import { computeImpact } from './graph.ts';
import { ProjectStore, listRegistry } from './store.ts';

/**
 * MCP 工具的纯函数层：让 Claude Code 等 coding agent 直接查询项目地图，
 * 不用重新扫描整个项目。全部只读，直接读 .whatdidaido 存储。
 */

export function listProjects(): { name: string; path: string; analyzed: boolean; summary?: string }[] {
  return listRegistry()
    .filter(r => fs.existsSync(r.path))
    .map(r => {
      const store = new ProjectStore(r.path);
      const views = store.getViews();
      return {
        name: r.name,
        path: r.path,
        analyzed: store.getMeta()?.status === 'ready',
        summary: views?.projectSummary,
      };
    });
}

export function getProjectSummary(store: ProjectStore) {
  const meta = store.getMeta();
  const views = store.getViews();
  return {
    name: meta?.name ?? path.basename(store.projectRoot),
    projectSummary: views?.projectSummary ?? '（还没有生成业务视图）',
    techStack: meta?.techStack ?? [],
    fileCount: meta?.fileCount ?? 0,
    gitCommit: meta?.gitCommit ?? null,
    analyzedAt: meta?.analyzedAt ?? null,
    views: (views?.views ?? []).map(v => ({ kind: v.kind, title: v.title, nodeCount: v.nodes.length })),
  };
}

export interface FeatureHit {
  id: string;
  viewKind: ViewKind;
  title: string;
  summary: string;
  sourceRefs: SourceRef[];
}

/** 按标题/概要文本搜业务节点（大小写不敏感，多关键词 AND） */
export function findFeature(store: ProjectStore, query: string): FeatureHit[] {
  const views = store.getViews();
  if (!views) return [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: FeatureHit[] = [];
  const seen = new Set<string>();
  for (const view of views.views) {
    for (const n of view.nodes) {
      const haystack = `${n.title} ${n.summary}`.toLowerCase();
      if (terms.every(t => haystack.includes(t)) && !seen.has(n.id)) {
        seen.add(n.id);
        hits.push({ id: n.id, viewKind: view.kind, title: n.title, summary: n.summary, sourceRefs: n.sourceRefs });
      }
    }
  }
  return hits.slice(0, 20);
}

/** 节点详情 + 真实源码片段 */
export function getNodeSource(store: ProjectStore, nodeId: string): { title: string; summary: string; sourceRefs: SourceRef[]; source: string } | null {
  const views = store.getViews();
  if (!views) return null;
  let node: BizNode | null = null;
  for (const v of views.views) {
    const n = v.nodes.find(x => x.id === nodeId);
    if (n) { node = n; break; }
  }
  if (!node) return null;
  const chunks: string[] = [];
  for (const ref of node.sourceRefs.slice(0, 5)) {
    try {
      const content = fs.readFileSync(path.join(store.projectRoot, ref.file), 'utf8');
      const lines = content.split('\n');
      const start = Math.max(0, (ref.startLine ?? 1) - 1);
      const end = Math.min(lines.length, ref.endLine ?? Math.min(lines.length, start + 80));
      chunks.push(`--- ${ref.file}${ref.symbol ? ` (${ref.symbol})` : ''} 第${start + 1}-${end}行 ---\n${lines.slice(start, end).join('\n')}`);
    } catch { /* 文件可能已删除 */ }
  }
  return { title: node.title, summary: node.summary, sourceRefs: node.sourceRefs, source: chunks.join('\n\n').slice(0, 20_000) };
}

/** 反查：这个文件在业务地图里扮演什么角色 */
export function getFileRole(store: ProjectStore, file: string): {
  file: string;
  symbols: Pick<SymbolFact, 'name' | 'kind' | 'route' | 'startLine'>[];
  usedByNodes: { id: string; viewKind: ViewKind; title: string; summary: string }[];
  importedBy: string[];
} {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  const files = store.getFiles();
  const fact = files[normalized];
  const views = store.getViews();
  const usedByNodes: { id: string; viewKind: ViewKind; title: string; summary: string }[] = [];
  for (const view of views?.views ?? []) {
    for (const n of view.nodes) {
      if (n.sourceRefs.some(r => r.file === normalized)) {
        usedByNodes.push({ id: n.id, viewKind: view.kind, title: n.title, summary: n.summary });
      }
    }
  }
  const importedBy = Object.values(files)
    .filter(f => f.imports.some(i => i.resolved === normalized))
    .map(f => f.path);
  return {
    file: normalized,
    symbols: (fact?.symbols ?? []).map(s => ({ name: s.name, kind: s.kind, route: s.route, startLine: s.startLine })),
    usedByNodes,
    importedBy,
  };
}

/** 影响范围（复用主分析器的实现） */
export function getImpact(store: ProjectStore, nodeIdOrFile: string) {
  const nodeId = nodeIdOrFile.includes(':') ? nodeIdOrFile : `file:${nodeIdOrFile.replace(/\\/g, '/')}`;
  return computeImpact(nodeId, store.getViews(), store.getFiles());
}

/** 把用户给的路径解析成 ProjectStore（必须已被 whatdidaido 分析过） */
export function resolveStore(projectPath: string): ProjectStore {
  const abs = path.resolve(projectPath);
  const store = new ProjectStore(abs);
  if (!store.getMeta()) {
    throw new Error(`这个路径还没被 whatdidaido 分析过：${abs}。先在 whatdidaido 面板里导入它。`);
  }
  return store;
}
