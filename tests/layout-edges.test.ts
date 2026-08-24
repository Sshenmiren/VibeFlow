import { describe, expect, it } from 'vitest';
import { layoutBizView } from '../client/src/layout.ts';
import type { BizView } from '../shared/types.ts';

const node = (id: string, group?: string) => ({
  id, title: id, summary: 's',
  sourceRefs: [{ file: 'a.ts' }],
  ...(group ? { group } : {}),
});

const stroke = (e: { style?: Record<string, unknown> }) => e.style?.stroke as string;
const dash = (e: { style?: Record<string, unknown> }) => e.style?.strokeDasharray as string | undefined;
const labelFill = (e: { labelStyle?: Record<string, unknown> }) => e.labelStyle?.color as string;
const shiftOf = (e: { data?: Record<string, unknown> }) => e.data?.labelShift as number;

describe('业务视图连线：逐条配色与标签可读性', () => {
  const flow: BizView = {
    kind: 'journey', title: '用户流程',
    nodes: [node('a'), node('b'), node('c'), node('d')],
    edges: [
      { id: 'e0', source: 'a', target: 'b', label: '点击开始' },
      { id: 'e1', source: 'b', target: 'c', label: '提交表单' },
      { id: 'e2', source: 'c', target: 'd', label: '完成' },
    ],
  };

  it('每条边分配不同颜色', () => {
    const { edges } = layoutBizView(flow, new Set(), null);
    const colors = edges.map(stroke);
    expect(new Set(colors).size).toBe(edges.length);
    expect(colors.every(c => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
  });

  it('标签字色与所属连线同色（一眼对应哪条线）', () => {
    const { edges } = layoutBizView(flow, new Set(), null);
    for (const e of edges) expect(labelFill(e)).toBe(stroke(e));
  });

  it('箭头颜色与线同色', () => {
    const { edges } = layoutBizView(flow, new Set(), null);
    for (const e of edges) {
      expect((e.markerEnd as { color: string }).color).toBe(stroke(e));
    }
  });

  it('标签用自定义边渲染，边框与线同色（HTML 标签才能挪位置避重叠）', () => {
    const { edges } = layoutBizView(flow, new Set(), null);
    for (const e of edges) {
      expect(e.type).toBe('biz');
      expect((e.labelStyle as { borderColor: string }).borderColor).toBe(stroke(e));
    }
  });

  it('边数超过配色盘长度时循环取色，不会崩', () => {
    const many: BizView = {
      kind: 'journey', title: 'x',
      nodes: Array.from({ length: 40 }, (_, i) => node(`n${i}`)),
      edges: Array.from({ length: 39 }, (_, i) => ({
        id: `e${i}`, source: `n${i}`, target: `n${i + 1}`, label: `第${i}步`,
      })),
    };
    const { edges } = layoutBizView(many, new Set(), null);
    expect(edges).toHaveLength(39);
    expect(edges.every(e => /^#[0-9a-f]{6}$/i.test(stroke(e)))).toBe(true);
    // 相邻边必须不同色，否则密集处仍然分不清
    for (let i = 1; i < edges.length; i++) {
      expect(stroke(edges[i])).not.toBe(stroke(edges[i - 1]));
    }
  });
});

describe('互为反向的两条边：标签必须错开，不能只显示一段文字', () => {
  const pair: BizView = {
    kind: 'pageflow', title: '页面流程',
    nodes: [node('gear1'), node('gear2'), node('other')],
    edges: [
      { id: 'p0', source: 'gear1', target: 'gear2', label: '按C键加速' },
      { id: 'p1', source: 'gear2', target: 'gear1', label: '再按C键减速' },
      { id: 'p2', source: 'gear1', target: 'other', label: '按住Shift' },
    ],
  };

  it('反向边对拿到方向相反的标签偏移', () => {
    const { edges } = layoutBizView(pair, new Set(), null);
    const byId = new Map(edges.map(e => [e.id, e]));
    const a = shiftOf(byId.get('p0')!);
    const b = shiftOf(byId.get('p1')!);
    expect(a).not.toBe(0);
    expect(b).not.toBe(0);
    expect(Math.sign(a)).toBe(-Math.sign(b)); // 一个往前推，一个往后推
  });

  it('没有反向配对的边不偏移（保持在路径中点）', () => {
    const { edges } = layoutBizView(pair, new Set(), null);
    const solo = edges.find(e => e.id === 'p2')!;
    expect(shiftOf(solo)).toBe(0);
  });

  it('三条边构成的环不会被误判为反向对', () => {
    const cycle: BizView = {
      kind: 'pageflow', title: 'x',
      nodes: [node('a'), node('b'), node('c')],
      edges: [
        { id: 'c0', source: 'a', target: 'b', label: '1' },
        { id: 'c1', source: 'b', target: 'c', label: '2' },
        { id: 'c2', source: 'c', target: 'a', label: '3' },
      ],
    };
    const { edges } = layoutBizView(cycle, new Set(), null);
    expect(edges.every(e => shiftOf(e) === 0)).toBe(true);
  });
});

describe('回流边（往回绕的连线）画成虚线', () => {
  it('正向边实线，回流边虚线', () => {
    const withBack: BizView = {
      kind: 'pageflow', title: '页面流程',
      nodes: [node('menu'), node('world'), node('fly')],
      edges: [
        { id: 'f0', source: 'menu', target: 'world', label: '进入' },
        { id: 'f1', source: 'world', target: 'fly', label: '按R起飞' },
        { id: 'f2', source: 'fly', target: 'world', label: '再按R关闭' }, // 回流
      ],
    };
    const { edges } = layoutBizView(withBack, new Set(), null);
    const byId = new Map(edges.map(e => [e.id, e]));
    expect(dash(byId.get('f0')!)).toBeUndefined();
    expect(dash(byId.get('f1')!)).toBeUndefined();
    expect(dash(byId.get('f2')!)).toBeTruthy();
  });
});

describe('功能总览：分组网格且不产生长线横穿', () => {
  const features: BizView = {
    kind: 'features', title: '功能总览',
    nodes: [
      node('login', '账号'), node('reg', '账号'),
      node('pay', '支付'), node('refund', '支付'),
      node('misc'),
    ],
    edges: [{ id: 'g0', source: 'login', target: 'pay', label: '下单' }],
  };

  it('同组节点排在同一列（x 相同），不同组分列', () => {
    const { nodes } = layoutBizView(features, new Set(), null);
    const x = (id: string) => nodes.find(n => n.id === id)!.position.x;
    expect(x('login')).toBe(x('reg'));
    expect(x('pay')).toBe(x('refund'));
    expect(x('login')).not.toBe(x('pay'));
  });

  it('有连线往来的组被排成相邻列（减少跨列长线）', () => {
    const { nodes } = layoutBizView(features, new Set(), null);
    const xs = [...new Set(nodes.map(n => n.position.x))].sort((a, b) => a - b);
    const x = (id: string) => nodes.find(n => n.id === id)!.position.x;
    const col = (id: string) => xs.indexOf(x(id));
    expect(Math.abs(col('login') - col('pay'))).toBe(1);
  });

  it('功能总览不把边标成回流（它是目录不是流程）', () => {
    const { edges } = layoutBizView(features, new Set(), null);
    expect(edges.every(e => dash(e) === undefined)).toBe(true);
  });
});
