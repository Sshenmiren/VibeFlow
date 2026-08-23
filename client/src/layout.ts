import dagre from '@dagrejs/dagre';
import type { BuiltInEdge, Edge, Node } from '@xyflow/react';
import type { BizView, TechGraph } from '../../shared/types.ts';

const BIZ_W = 200;
const BIZ_H = 78;

/**
 * 边配色盘：同一视图内相邻的边取不同颜色，密集连线时能用颜色跟着一条线走到底。
 * 取自舆图主题的深色系（朱砂/松绿/黛蓝/赭黄/紫褐/青瓷…），保证在纸色底上都够深、可读。
 */
const EDGE_COLORS = [
  '#b73e21', // 朱砂
  '#3d7a63', // 松绿
  '#3d6590', // 黛蓝
  '#a3762b', // 赭黄
  '#7c4a72', // 紫褐
  '#2f7070', // 青瓷
  '#8c5a2b', // 檀褐
  '#5b6bab', // 靛蓝
  '#96432f', // 砖红
  '#4a7a3d', // 竹绿
  '#a14a6b', // 胭脂
  '#476b8a', // 石青
  '#7d6420', // 秋褐
  '#6a4b9c', // 藤紫
  '#2d7355', // 苍绿
  '#9c5320', // 陶橙
  '#3f5f7f', // 深黛
  '#8a3f52', // 绛紫
];

/** 按边在视图中的序号取色，确保每条边颜色不同（超过盘长才循环） */
function edgeColor(i: number): string {
  return EDGE_COLORS[i % EDGE_COLORS.length];
}

/**
 * 统一的业务边样式：线与标签同色，标签带纸色描边避免压线糊成一片。
 * back=true（回流边，如"再按一次关闭"）画成虚线：它必然要往回绕，虚线让人一眼
 * 认出是"返回/回退"，而不是误以为图乱。
 */
function bizEdge(
  e: { id: string; source: string; target: string; label?: string },
  i: number,
  back = false,
): Edge {
  const color = edgeColor(i);
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'smoothstep',
    // 圆角拐弯 + 每条边错开一点，避免平行边完全重叠
    pathOptions: { borderRadius: 14, offset: 12 + (i % 3) * 6 },
    style: {
      stroke: color,
      strokeWidth: back ? 1.5 : 1.8,
      ...(back ? { strokeDasharray: '7 5' } : {}),
    },
    markerEnd: { type: 'arrowclosed' as const, color, width: 16, height: 16 },
    labelShowBg: true,
    labelBgPadding: [5, 3],
    labelBgBorderRadius: 4,
    labelBgStyle: { fill: '#fdfaf1', fillOpacity: 0.92, stroke: color, strokeWidth: 1 },
    labelStyle: { fill: color, fontSize: 11, fontWeight: 600 },
  } satisfies BuiltInEdge as Edge;
}

/** 业务视图：dagre 分层布局（journey/pageflow/dataflow 左→右；features 按组网格） */
export function layoutBizView(view: BizView, staleIds: Set<string>, selectedId: string | null): { nodes: Node[]; edges: Edge[] } {
  if (view.kind === 'features') return layoutFeatureGrid(view, staleIds, selectedId);

  const g = new dagre.graphlib.Graph();
  // ranksep 加大给连线标签留位置；nodesep 加大减少同层节点间的边穿插
  g.setGraph({
    rankdir: 'LR', nodesep: 58, ranksep: 150, marginx: 48, marginy: 48,
    ranker: 'tight-tree', // 比默认 network-simplex 更少长边跨层，减少乱麻
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of view.nodes) g.setNode(n.id, { width: BIZ_W, height: BIZ_H });
  // 把标签尺寸告诉 dagre，让它为标签预留空间而不是让标签压在别的线上
  for (const e of view.edges) {
    const len = (e.label ?? '').length;
    g.setEdge(e.source, e.target, len ? { width: len * 11 + 10, height: 18, labelpos: 'c' } : {});
  }
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
  // 回流边判定：目标不在源的右侧（dagre 布完后源 x >= 目标 x），说明这条线要往回绕
  const edges: Edge[] = view.edges.map((e, i) => {
    const s = g.node(e.source);
    const t = g.node(e.target);
    const back = !!s && !!t && t.x <= s.x;
    return bizEdge(e, i, back);
  });
  return { nodes, edges };
}

/**
 * 功能地图：按 group 分列的网格。
 * 分组是这个视图的意义所在（按业务域归类），所以不交给 dagre 重排；
 * 但列的先后与组内顺序会参考连线，让有关系的功能尽量靠近，避免长线横穿整张图。
 */
function layoutFeatureGrid(view: BizView, staleIds: Set<string>, selectedId: string | null): { nodes: Node[]; edges: Edge[] } {
  const groups = new Map<string, typeof view.nodes>();
  for (const n of view.nodes) {
    const key = n.group ?? '其他';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  // 组间关系：把有连线往来的组排在相邻列，减少跨列长线
  const groupOf = new Map<string, string>();
  for (const [key, members] of groups) for (const m of members) groupOf.set(m.id, key);
  const linkWeight = new Map<string, number>();
  for (const e of view.edges) {
    const a = groupOf.get(e.source);
    const b = groupOf.get(e.target);
    if (a && b && a !== b) {
      linkWeight.set(`${a}|${b}`, (linkWeight.get(`${a}|${b}`) ?? 0) + 1);
      linkWeight.set(`${b}|${a}`, (linkWeight.get(`${b}|${a}`) ?? 0) + 1);
    }
  }
  // 贪心串联：从连接最多的组出发，每次挑与已排最后一组关系最强的组
  const remaining = [...groups.keys()];
  const degree = (k: string) => remaining.reduce((s, o) => s + (o === k ? 0 : (linkWeight.get(`${k}|${o}`) ?? 0)), 0);
  const ordered: string[] = [];
  if (remaining.length) {
    remaining.sort((a, b) => degree(b) - degree(a) || a.localeCompare(b));
    ordered.push(remaining.shift()!);
    while (remaining.length) {
      const last = ordered[ordered.length - 1];
      remaining.sort((a, b) =>
        (linkWeight.get(`${last}|${b}`) ?? 0) - (linkWeight.get(`${last}|${a}`) ?? 0) || a.localeCompare(b));
      ordered.push(remaining.shift()!);
    }
  }

  const nodes: Node[] = [];
  let x = 48;
  for (const key of ordered) {
    const members = groups.get(key)!;
    // 组内：有跨组连线的成员排在前面（靠上），短线优先
    const linked = new Set<string>();
    for (const e of view.edges) {
      if (groupOf.get(e.source) !== groupOf.get(e.target)) { linked.add(e.source); linked.add(e.target); }
    }
    const sorted = [...members].sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)));
    let y = 64;
    for (const n of sorted) {
      nodes.push({
        id: n.id,
        type: 'biz',
        position: { x, y },
        data: { biz: n, viewKind: view.kind, stale: staleIds.has(n.id), selected: selectedId === n.id },
      });
      y += BIZ_H + 52;
    }
    x += BIZ_W + 120; // 列间距加大，给跨列连线和标签留通道
  }

  // 功能总览是分组目录而非流程，不区分回流边（列序已按关系排过）
  const ids = new Set(view.nodes.map(n => n.id));
  const edges: Edge[] = view.edges
    .filter(e => ids.has(e.source) && ids.has(e.target))
    .map((e, i) => bizEdge(e, i));
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

  // 技术图边数可能上百，逐条撒彩虹只会更花：改为按"来源文件夹"配色，
  // 同一文件夹发出的依赖同色，就能顺着颜色看出某个模块依赖谁。
  const dirColor = new Map<string, string>();
  [...byDir.keys()].forEach((dir, i) => dirColor.set(dir, edgeColor(i)));
  const edges: Edge[] = graph.edges.map(e => {
    const srcDir = fileDir.get(e.source.slice(5)) ?? './';
    const color = dirColor.get(srcDir) ?? '#a2947c';
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'default',
      markerEnd: { type: 'arrowclosed' as const, color, width: 14, height: 14 },
      style: { stroke: color, strokeWidth: 1.2, opacity: 0.5 },
    };
  });
  return { nodes, edges };
}
