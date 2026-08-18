import { describe, expect, it } from 'vitest';
import { groundViews } from '../server/views.ts';
import type { FileFact } from '../shared/types.ts';

const fakeFile = (path: string): FileFact => ({
  path, lang: 'ts', hash: 'h', size: 1, lines: 1, imports: [], symbols: [], tags: [],
});

const files: Record<string, FileFact> = {
  'src/App.tsx': fakeFile('src/App.tsx'),
  'src/api.ts': fakeFile('src/api.ts'),
};

describe('groundViews：sourceRef 落地校验与 id 规范化', () => {
  it('新生成的裸 id 加上视图前缀', () => {
    const { views } = groundViews([{
      kind: 'journey', title: '用户旅程',
      nodes: [{ id: 'open_app', title: '打开', summary: 's', sourceRefs: [{ file: 'src/App.tsx' }] }],
      edges: [],
    }], files);
    expect(views[0].nodes[0].id).toBe('journey:open_app');
  });

  it('增量刷新时已带前缀的 id 保持原样（不二次加前缀）', () => {
    const { views } = groundViews([{
      kind: 'journey', title: '用户旅程',
      nodes: [{ id: 'journey:open_app', title: '打开', summary: 's', sourceRefs: [{ file: 'src/App.tsx' }] }],
      edges: [],
    }], files);
    expect(views[0].nodes[0].id).toBe('journey:open_app');
  });

  it('边的端点同样规范化，混用裸 id 和前缀 id 也能连上', () => {
    const { views } = groundViews([{
      kind: 'journey', title: '用户旅程',
      nodes: [
        { id: 'journey:a', title: 'A', summary: 's', sourceRefs: [{ file: 'src/App.tsx' }] },
        { id: 'b', title: 'B', summary: 's', sourceRefs: [{ file: 'src/api.ts' }] },
      ],
      edges: [{ source: 'journey:a', target: 'b', label: 'x' }],
    }], files);
    expect(views[0].edges).toHaveLength(1);
    expect(views[0].edges[0].source).toBe('journey:a');
    expect(views[0].edges[0].target).toBe('journey:b');
  });

  it('引用不存在文件的节点被剔除，指向它的边一并剔除', () => {
    const { views, dropped } = groundViews([{
      kind: 'journey', title: '用户旅程',
      nodes: [
        { id: 'a', title: 'A', summary: 's', sourceRefs: [{ file: 'src/App.tsx' }] },
        { id: 'ghost', title: '鬼', summary: 's', sourceRefs: [{ file: '不存在的.ts' }] },
      ],
      edges: [{ source: 'a', target: 'ghost' }],
    }], files);
    expect(dropped).toBe(1);
    expect(views[0].nodes).toHaveLength(1);
    expect(views[0].edges).toHaveLength(0);
  });
});
