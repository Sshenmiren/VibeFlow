import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFactsDigest, groundViews } from '../server/views.ts';
import type { FileFact, ProjectMeta } from '../shared/types.ts';

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

describe('buildFactsDigest：不受支持语言项目不产出空 digest', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wdad-digest-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const otherFile = (p: string): FileFact => ({
    path: p, lang: 'other', hash: 'h', size: 1, lines: 3, imports: [], symbols: [], tags: [],
  });
  const meta: ProjectMeta = {
    id: 'x', path: tmp, name: 'psproj', techStack: [], importedAt: '', analysisVersion: 1,
    analyzedAt: '', gitCommit: '', fileCount: 1, status: 'ready',
  };

  it('全是 .ps1/.txt（other 语言、零符号）时，靠内容预览兜底而非跳过', () => {
    fs.writeFileSync(path.join(tmp, 'run.ps1'), 'param($Id)\nWrite-Host "查询邮箱前缀"\n');
    fs.writeFileSync(path.join(tmp, 'readme.txt'), '输入学号即可查询同学邮箱\n');
    const files: Record<string, FileFact> = {
      'run.ps1': otherFile('run.ps1'),
      'readme.txt': otherFile('readme.txt'),
    };
    const digest = buildFactsDigest(tmp, meta, files);
    expect(digest).toContain('run.ps1');
    expect(digest).toContain('查询邮箱前缀');
    expect(digest).toContain('输入学号即可查询同学邮箱');
    expect(digest).toContain('内容预览');
  });

  it('存在带符号文件时，other 文件仍照旧跳过（不喂预览、不膨胀成本）', () => {
    fs.writeFileSync(path.join(tmp, 'skip.ps1'), 'Write-Host "不该出现"\n');
    const files: Record<string, FileFact> = {
      'src/App.tsx': { path: 'src/App.tsx', lang: 'ts', hash: 'h', size: 1, lines: 1, imports: [], symbols: [{ name: 'App', kind: 'function', startLine: 1, endLine: 1, calls: [] }], tags: [] },
      'skip.ps1': otherFile('skip.ps1'),
    };
    const digest = buildFactsDigest(tmp, meta, files);
    expect(digest).toContain('src/App.tsx');
    expect(digest).not.toContain('skip.ps1');
  });
});
