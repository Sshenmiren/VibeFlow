import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findFeature, getFileRole, getNodeSource, getProjectSummary } from '../server/mcp-tools.ts';
import { ProjectStore } from '../server/store.ts';
import type { BusinessViews, FileFact } from '../shared/types.ts';

let root: string;
let store: ProjectStore;

beforeAll(() => {
  // 造一个最小的假项目 + .vibeflow 存储
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdad-mcp-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'pay.ts'), 'export function charge(amount: number) {\n  return amount * 100;\n}\n');
  store = new ProjectStore(root);

  const files: Record<string, FileFact> = {
    'src/pay.ts': {
      path: 'src/pay.ts', lang: 'ts', hash: 'h1', size: 60, lines: 3,
      imports: [],
      symbols: [{ name: 'charge', kind: 'function', exported: true, startLine: 1, endLine: 3, calls: [] }],
      tags: [],
    },
  };
  store.saveFiles(files);

  const views: BusinessViews = {
    views: [{
      kind: 'features', title: '功能地图',
      nodes: [{
        id: 'features:pay', title: '支付扣款', summary: '按金额向用户收钱',
        sourceRefs: [{ file: 'src/pay.ts', symbol: 'charge', startLine: 1, endLine: 3 }],
      }],
      edges: [],
    }],
    analysisVersion: 1, generatedAt: '2026-08-18T00:00:00Z', gitCommit: 'abc1234',
    projectSummary: '一个演示支付的项目',
  };
  store.saveViews(views);
  store.saveMeta({
    id: 'test', path: root, name: 'demo', techStack: ['TypeScript'],
    importedAt: '', analysisVersion: 1, analyzedAt: '', gitCommit: 'abc1234', fileCount: 1, status: 'ready',
  });
});

describe('MCP 工具：Claude Code 反向查地图', () => {
  it('get_project_summary 返回总述与视图统计', () => {
    const s = getProjectSummary(store);
    expect(s.projectSummary).toContain('支付');
    expect(s.techStack).toContain('TypeScript');
    expect(s.views[0]).toMatchObject({ kind: 'features', nodeCount: 1 });
  });

  it('find_feature 按标题/概要文本命中节点并带源码位置', () => {
    const hits = findFeature(store, '扣款');
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('features:pay');
    expect(hits[0].sourceRefs[0].file).toBe('src/pay.ts');
    expect(findFeature(store, '不存在的功能')).toHaveLength(0);
  });

  it('get_node_source 返回节点信息和真实代码片段', () => {
    const r = getNodeSource(store, 'features:pay');
    expect(r).not.toBeNull();
    expect(r!.title).toBe('支付扣款');
    expect(r!.source).toContain('function charge');
  });

  it('get_file_role 反查文件被哪些业务环节使用', () => {
    const r = getFileRole(store, 'src/pay.ts');
    expect(r.usedByNodes[0]).toMatchObject({ id: 'features:pay', title: '支付扣款' });
    expect(r.symbols[0].name).toBe('charge');
  });
});
