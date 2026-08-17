import path from 'node:path';
import type {
  BusinessViews, FileFact, ImpactResult, TechEdge, TechGraph, TechNode,
} from '../shared/types.ts';

/** 从文件事实构建技术关系图：文件夹→文件（包含）+ 文件→文件（导入） */
export function buildTechGraph(files: Record<string, FileFact>): TechGraph {
  const nodes: TechNode[] = [];
  const edges: TechEdge[] = [];
  const folders = new Set<string>();

  for (const f of Object.values(files)) {
    let dir = path.posix.dirname(f.path);
    while (dir && dir !== '.') {
      folders.add(dir);
      dir = path.posix.dirname(dir);
    }
  }

  for (const folder of [...folders].sort()) {
    const parent = path.posix.dirname(folder);
    nodes.push({
      id: `folder:${folder}`,
      type: 'folder',
      label: path.posix.basename(folder),
      path: folder,
      parent: parent !== '.' ? `folder:${parent}` : undefined,
    });
  }

  for (const f of Object.values(files)) {
    const dir = path.posix.dirname(f.path);
    nodes.push({
      id: `file:${f.path}`,
      type: 'file',
      label: path.posix.basename(f.path),
      path: f.path,
      parent: dir !== '.' ? `folder:${dir}` : undefined,
      lang: f.lang,
      symbolCount: f.symbols.length,
      tags: f.tags,
    });
    for (const imp of f.imports) {
      if (!imp.resolved || !files[imp.resolved]) continue;
      edges.push({
        id: `e:${f.path}->${imp.resolved}`,
        source: `file:${f.path}`,
        target: `file:${imp.resolved}`,
        kind: 'import',
        names: imp.names,
      });
    }
  }

  // 去重（同一对文件多条 import 合并）
  const seen = new Map<string, TechEdge>();
  for (const e of edges) {
    const prev = seen.get(e.id);
    if (prev) prev.names = [...new Set([...(prev.names ?? []), ...(e.names ?? [])])];
    else seen.set(e.id, e);
  }
  return { nodes, edges: [...seen.values()] };
}

/** 反向依赖表：谁导入了这个文件 */
export function buildDependents(files: Record<string, FileFact>): Map<string, Set<string>> {
  const dependents = new Map<string, Set<string>>();
  for (const f of Object.values(files)) {
    for (const imp of f.imports) {
      if (!imp.resolved) continue;
      if (!dependents.has(imp.resolved)) dependents.set(imp.resolved, new Set());
      dependents.get(imp.resolved)!.add(f.path);
    }
  }
  return dependents;
}

/** 影响范围：节点相关文件 + 依赖这些文件的下游 + 共享文件的其他业务节点 */
export function computeImpact(
  nodeId: string,
  views: BusinessViews | null,
  files: Record<string, FileFact>,
): ImpactResult {
  const nodeFiles = new Set<string>();
  const relatedBizNodes: ImpactResult['relatedBizNodes'] = [];

  if (views) {
    for (const view of views.views) {
      for (const n of view.nodes) {
        if (n.id === nodeId) {
          for (const ref of n.sourceRefs) nodeFiles.add(ref.file);
        }
      }
    }
  }
  // 技术节点：file:xxx 直接取路径
  if (nodeId.startsWith('file:')) nodeFiles.add(nodeId.slice(5));

  const dependents = buildDependents(files);
  const downstream = new Set<string>();
  const queue = [...nodeFiles];
  while (queue.length) {
    const f = queue.pop()!;
    for (const dep of dependents.get(f) ?? []) {
      if (!downstream.has(dep) && !nodeFiles.has(dep)) {
        downstream.add(dep);
        queue.push(dep);
      }
    }
  }

  if (views) {
    const affected = new Set([...nodeFiles, ...downstream]);
    for (const view of views.views) {
      for (const n of view.nodes) {
        if (n.id === nodeId) continue;
        if (n.sourceRefs.some(r => affected.has(r.file))) {
          relatedBizNodes.push({ id: n.id, title: n.title, viewKind: view.kind });
        }
      }
    }
  }

  return {
    nodeId,
    files: [...nodeFiles],
    dependents: [...downstream],
    relatedBizNodes,
  };
}

/** 文件集合 → 受影响的业务节点 id（增量分析、修改计划都用它） */
export function bizNodesTouchingFiles(views: BusinessViews | null, changed: string[]): string[] {
  if (!views) return [];
  const set = new Set(changed);
  const ids: string[] = [];
  for (const view of views.views) {
    for (const n of view.nodes) {
      if (n.sourceRefs.some(r => set.has(r.file))) ids.push(n.id);
    }
  }
  return [...new Set(ids)];
}
