/** 冒烟测试：对真实项目跑全量分析，打印统计。用法：npx tsx scripts/smoke-analyze.ts <项目路径> */
import { analyzeFull } from '../server/analyzer.ts';
import { buildTechGraph } from '../server/graph.ts';
import { ProjectStore, projectIdFor } from '../server/store.ts';
import path from 'node:path';

const target = process.argv[2];
if (!target) { console.error('用法：npx tsx scripts/smoke-analyze.ts <项目路径>'); process.exit(1); }

const abs = path.resolve(target);
const store = new ProjectStore(abs);
const meta = store.getMeta() ?? {
  id: projectIdFor(abs), path: abs, name: path.basename(abs),
  techStack: [], importedAt: new Date().toISOString(),
  analysisVersion: 0, analyzedAt: null, gitCommit: null, fileCount: 0, status: 'analyzing' as const,
};

const updated = await analyzeFull(store, meta, (p) => {
  if (p.phase === 'parsing' && p.done % 10 === 0) console.log(`  解析 ${p.done}/${p.total}`);
});

const files = store.getFiles();
const graph = buildTechGraph(files);
console.log('\n=== 分析结果 ===');
console.log('技术栈：', updated.techStack.join(', '));
console.log('文件数：', updated.fileCount);
console.log('图节点：', graph.nodes.length, '（文件夹', graph.nodes.filter(n => n.type === 'folder').length, '+ 文件', graph.nodes.filter(n => n.type === 'file').length, '）');
console.log('导入边：', graph.edges.length);

const withSymbols = Object.values(files).filter(f => f.symbols.length > 0);
console.log('有符号的文件：', withSymbols.length);
const routes = Object.values(files).flatMap(f => f.symbols.filter(s => s.kind === 'route').map(s => `${s.route} (${f.path})`));
console.log('识别的路由：');
for (const r of routes) console.log('  ', r);

const resolved = Object.values(files).flatMap(f => f.imports).filter(i => i.resolved).length;
const total = Object.values(files).flatMap(f => f.imports).length;
console.log(`导入解析率：${resolved}/${total}`);

// 抽查几条边
console.log('\n示例边：');
for (const e of graph.edges.slice(0, 8)) console.log('  ', e.source.slice(5), '→', e.target.slice(5));
