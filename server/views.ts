import fs from 'node:fs';
import path from 'node:path';
import type { BusinessViews, BizView, FileFact, ProjectMeta } from '../shared/types.ts';
import { ViewsPayloadSchema } from '../shared/schemas.ts';
import { extractJson, getProvider } from './ai/provider.ts';
import type { ProjectStore } from './store.ts';

/**
 * 业务视图生成：静态事实 → LLM 翻译 → zod 校验 → sourceRef 落地校验。
 * LLM 只做"翻译"，不许凭空发明文件；引用不存在的文件的节点会被修复或剔除。
 */
export async function generateViews(store: ProjectStore, meta: ProjectMeta): Promise<BusinessViews> {
  const files = store.getFiles();
  const digest = buildFactsDigest(store.projectRoot, meta, files);
  const provider = getProvider();

  const prompt = buildPrompt(digest);
  let result = await provider.generate({ prompt, timeoutMs: 6 * 60_000 });
  if (result.isError) throw new Error(result.errorMessage ?? 'AI 生成失败');

  let payload = tryParse(result.text);
  if (!payload.ok) {
    // 重试一次，附上错误反馈
    result = await provider.generate({
      prompt: `${prompt}\n\n你上一次的输出无法解析：${payload.error}\n请严格输出合法 JSON，不要任何多余文字。`,
      timeoutMs: 6 * 60_000,
    });
    if (result.isError) throw new Error(result.errorMessage ?? 'AI 生成失败');
    payload = tryParse(result.text);
    if (!payload.ok) throw new Error(`AI 输出两次校验失败：${payload.error}`);
  }

  const { views, dropped } = groundViews(payload.data.views, files);
  const businessViews: BusinessViews = {
    views,
    analysisVersion: meta.analysisVersion,
    generatedAt: new Date().toISOString(),
    gitCommit: meta.gitCommit,
    projectSummary: payload.data.projectSummary,
  };
  store.saveViews(businessViews);
  store.addTimelineEvent({
    kind: 'views-generated',
    title: '生成了项目理解视图',
    detail: dropped > 0 ? `${views.reduce((n, v) => n + v.nodes.length, 0)} 个环节（剔除 ${dropped} 个无法对应源码的节点）` : `${views.reduce((n, v) => n + v.nodes.length, 0)} 个环节`,
    costUsd: result.costUsd,
  });
  return businessViews;
}

function tryParse(text: string): { ok: true; data: import('../shared/schemas.ts').ViewsPayload } | { ok: false; error: string } {
  try {
    const json = extractJson(text);
    const parsed = ViewsPayloadSchema.safeParse(json);
    if (!parsed.success) return { ok: false, error: parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
    return { ok: true, data: parsed.data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** 落地校验：sourceRefs 必须指向真实文件；试 basename 修复；无有效引用的节点剔除 */
function groundViews(rawViews: import('../shared/schemas.ts').ViewsPayload['views'], files: Record<string, FileFact>): { views: BizView[]; dropped: number } {
  const byBasename = new Map<string, string[]>();
  for (const p of Object.keys(files)) {
    const base = path.posix.basename(p);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base)!.push(p);
  }

  let dropped = 0;
  const views: BizView[] = [];
  for (const rv of rawViews) {
    const validNodes = [];
    const droppedIds = new Set<string>();
    for (const node of rv.nodes) {
      const refs = [];
      for (const ref of node.sourceRefs) {
        const normalized = ref.file.replace(/\\/g, '/').replace(/^\.\//, '');
        if (files[normalized]) {
          refs.push({ ...ref, file: normalized, ...symbolLines(files[normalized], ref.symbol) });
        } else {
          const candidates = byBasename.get(path.posix.basename(normalized));
          if (candidates?.length === 1) {
            refs.push({ ...ref, file: candidates[0], ...symbolLines(files[candidates[0]], ref.symbol) });
          }
        }
      }
      if (refs.length > 0) {
        validNodes.push({ ...node, id: `${rv.kind}:${node.id}`, sourceRefs: refs });
      } else {
        dropped++;
        droppedIds.add(node.id);
      }
    }
    const ids = new Set(validNodes.map(n => n.id));
    const edges = rv.edges
      .map((e, i) => ({ id: `${rv.kind}:e${i}`, source: `${rv.kind}:${e.source}`, target: `${rv.kind}:${e.target}`, label: e.label }))
      .filter(e => ids.has(e.source) && ids.has(e.target));
    views.push({ kind: rv.kind, title: rv.title, nodes: validNodes, edges });
  }
  return { views, dropped };
}

function symbolLines(fact: FileFact, symbol?: string): { startLine?: number; endLine?: number } {
  if (!symbol) return {};
  const s = fact.symbols.find(x => x.name === symbol);
  return s ? { startLine: s.startLine, endLine: s.endLine } : {};
}

// ---------- 事实摘要（喂给 LLM 的全部依据） ----------

export function buildFactsDigest(root: string, meta: ProjectMeta, files: Record<string, FileFact>): string {
  const lines: string[] = [];
  lines.push(`项目名：${meta.name}`);
  lines.push(`技术栈：${meta.techStack.join(', ') || '未知'}`);

  const readme = Object.keys(files).find(p => /^readme\.md$/i.test(p));
  if (readme) {
    try {
      const content = fs.readFileSync(path.join(root, readme), 'utf8');
      lines.push(`\n== README 开头 ==\n${content.split('\n').slice(0, 40).join('\n')}`);
    } catch { /* ignore */ }
  }

  lines.push('\n== 文件与符号（静态分析事实，全部真实存在） ==');
  const sorted = Object.values(files).sort((a, b) => a.path.localeCompare(b.path));
  // 成本控制：大项目只保留符号概要
  const budget = 60_000;
  let used = 0;
  for (const f of sorted) {
    if (f.lang === 'other') continue;
    if (f.lang === 'json' && !f.path.endsWith('package.json')) continue;
    const parts: string[] = [`\n${f.path} [${f.lang}${f.tags.length ? ' ' + f.tags.join(',') : ''}] ${f.lines}行`];
    if (f.imports.length) {
      const internal = f.imports.filter(i => i.resolved).map(i => i.resolved);
      const external = f.imports.filter(i => !i.resolved).map(i => i.specifier).filter(s => !s.startsWith('.'));
      if (internal.length) parts.push(`  导入(项目内): ${[...new Set(internal)].join(', ')}`);
      if (external.length) parts.push(`  导入(外部): ${[...new Set(external)].slice(0, 10).join(', ')}`);
    }
    for (const s of f.symbols.slice(0, 25)) {
      const extra = s.route ? ` 路由=${s.route}` : '';
      const calls = s.calls.length ? ` 调用: ${s.calls.slice(0, 12).join(',')}` : '';
      parts.push(`  - ${s.kind} ${s.signature ?? s.name}${extra}${calls}`);
    }
    const chunk = parts.join('\n');
    if (used + chunk.length > budget) {
      parts.length = 1; // 超预算只留文件行
      lines.push(parts[0]);
      used += parts[0].length;
    } else {
      lines.push(chunk);
      used += chunk.length;
    }
  }
  return lines.join('\n');
}

function buildPrompt(digest: string): string {
  return `你是一个把代码项目翻译给"完全不懂编程的人"的解说员。下面是一个项目的静态分析事实（文件、符号、导入、路由都真实存在，不许编造不在列表里的文件）。

${digest}

请基于以上事实生成 4 个理解视图，输出严格的 JSON（不要 markdown 围栏外的任何文字）：

{
  "projectSummary": "这个项目到底做了什么（2-4句，给完全不懂编程的人看）",
  "views": [
    { "kind": "journey", "title": "用户旅程", "nodes": [...], "edges": [...] },
    { "kind": "features", "title": "功能地图", "nodes": [...], "edges": [...] },
    { "kind": "pageflow", "title": "页面流程", "nodes": [...], "edges": [...] },
    { "kind": "dataflow", "title": "数据流", "nodes": [...], "edges": [...] }
  ]
}

每个 node 的结构：
{ "id": "短英文id", "title": "≤12字中文标题", "summary": "一句话中文说明", "sourceRefs": [{"file": "必须是上面列表中的真实路径", "symbol": "可选，真实符号名"}], "group": "可选分组名", "icon": "一个emoji" }

每个 edge：{ "source": "节点id", "target": "节点id", "label": "≤10字的动作说明，如'点击开始'" }

要求：
- journey：普通用户从打开产品到完成核心任务的旅程（6-12个节点，按时间顺序连线）
- features：业务能力地图（按 group 分组，如"游戏对局""角色管理"；节点间少连线或不连线）
- pageflow：界面/页面之间的跳转关系（点什么按钮到哪个界面）
- dataflow：数据从哪来、经过哪、存到哪（如 用户输入→前端→API→引擎→存档文件）
- 所有文字面向没有编程基础的人：不许出现"组件""路由""中间件""hook""API端点"这类术语，用"页面""按钮""服务器""保存"这类日常词
- 每个节点必须引用至少1个真实文件路径`;
}
