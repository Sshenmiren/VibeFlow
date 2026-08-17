import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type { BizView, TechGraph } from '../../shared/types.ts';

const BIZ_W = 200;
const BIZ_H = 78;

/** 业务视图：dagre 分层布局（journey/pageflow/dataflow 左→右；features 按组网格） */
export function layoutBizView(view: BizView, staleIds: Set<string>, selectedId: string | null): { nodes: Node[]; edges: Edge[] } {
  if (view.kind === 'features') return layoutFeatureGrid(view, staleIds, selectedId);

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 90, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of view.nodes) g.setNode(n.id, { width: BIZ_W, height: BIZ_H });
  for (const e of view.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const order = new Map(view.nodes.map((n, i) => [n.id, i]));
  const nodes: Node[] = view.nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: 'biz',
      position: { x: pos.x - BIZ_W / 2, y: pos.y - BIZ_H / 2 },
      data: {
        biz: n,
        viewKind: view.kind,
        step: (order.get(n.id) ?? 0) + 1,
        stale: staleIds.has(n.id),
        selected: selectedId === n.id,
      },
    };
  });
  const edges: Edge[] = view.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'smoothstep',
    markerEnd: { type: 'arrowclosed' as const, color: '#6f6450' },
  }));
  return { nodes, edges };
}

/** 功能地图：按 group 分列的网格 */
function layoutFeatureGrid(view: BizView, staleIds: Set<string>, selectedId: string | null): { nodes: Node[]; edges: Edge[] } {
  const groups = new Map<string, typeof view.nodes>();
  for (const n of view.nodes) {
    const key = n.group ?? '其他';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }
  const nodes: Node[] = [];
  let x = 40;
  for (const [, members] of groups) {
    let y = 60;
    for (const n of members) {
      nodes.push({
        id: n.id,
        type: 'biz',
        position: { x, y },
        data: { biz: n, viewKind: view.kind, stale: staleIds.has(n.id), selected: selectedId === n.id },
      });
      y += BIZ_H + 46;
    }
    x += BIZ_W + 70;
  }
  const ids = new Set(view.nodes.map(n => n.id));
  const edges: Edge[] = view.edges
    .filter(e => ids.has(e.source) && ids.has(e.target))
    .map(e => ({
      id: e.id, source: e.source, target: e.target, label: e.label, type: 'smoothstep',
      markerEnd: { type: 'arrowclosed' as const, color: '#6f6450' },
    }));
  return { nodes, edges };
}

const FILE_W = 168;
const FILE_H = 44;
const GRID_COLS = 3;
const PAD = 16;
const HEADER = 30;

/**
 * 技术图：文件夹为容器（这个文件夹→有哪些文件），文件夹间用聚合导入关系 dagre 布局，
 * 文件在容器内网格排列，文件→文件导入边直接显示。
 */
export function layoutTechGraph(graph: TechGraph, staleFiles: Set<string>, selectedId: string | null): { nodes: Node[]; edges: Edge[] } {
  // 文件按所在目录分容器（根目录文件归 "./"）
  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : './');
  const files = graph.nodes.filter(n => n.type === 'file');
  const byDir = new Map<string, typeof files>();
  for (const f of files) {
    const dir = dirOf(f.path);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(f);
  }

  // 容器尺寸
  const dims = new Map<string, { w: number; h: number }>();
  for (const [dir, members] of byDir) {
    const cols = Math.min(GRID_COLS, Math.max(1, Math.ceil(Math.sqrt(members.length))));
    const rows = Math.ceil(members.length / cols);
    dims.set(dir, {
      w: cols * (FILE_W + PAD) + PAD,
      h: HEADER + rows * (FILE_H + PAD) + PAD,
    });
  }

  // 目录级聚合边 → dagre 布局容器
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 46, ranksep: 110, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const [dir, d] of dims) g.setNode(dir, { width: d.w, height: d.h });
  const dirEdges = new Set<string>();
  const fileDir = new Map(files.map(f => [f.path, dirOf(f.path)]));
  for (const e of graph.edges) {
    const s = fileDir.get(e.source.slice(5));
    const t = fileDir.get(e.target.slice(5));
    if (s && t && s !== t) dirEdges.add(`${s}→${t}`);
  }
  for (const key of dirEdges) {
    const [s, t] = key.split('→');
    g.setEdge(s, t);
  }
  dagre.layout(g);

  const nodes: Node[] = [];
  for (const [dir, members] of byDir) {
    const pos = g.node(dir);
    const d = dims.get(dir)!;
    nodes.push({
      id: `dir:${dir}`,
      type: 'folder',
      position: { x: pos.x - d.w / 2, y: pos.y - d.h / 2 },
      data: { label: dir },
      style: { width: d.w, height: d.h },
      selectable: false,
      draggable: true,
    });
    const cols = Math.min(GRID_COLS, Math.max(1, Math.ceil(Math.sqrt(members.length))));
    members.forEach((f, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodes.push({
        id: f.id,
        type: 'techFile',
        parentId: `dir:${dir}`,
        extent: 'parent',
        position: { x: PAD + col * (FILE_W + PAD), y: HEADER + row * (FILE_H + PAD) },
        data: {
          tech: f,
          stale: staleFiles.has(f.path),
          selected: selectedId === f.id,
        },
      });
    });
  }

  const edges: Edge[] = graph.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'default',
    markerEnd: { type: 'arrowclosed' as const, color: '#a2947c' },
    style: { opacity: 0.55 },
  }));
  return { nodes, edges };
}
