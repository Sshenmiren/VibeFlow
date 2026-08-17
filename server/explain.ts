import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { BizNode, FileFact, NodeExplanation, ViewKind } from '../shared/types.ts';
import { ExplanationBatchSchema } from '../shared/schemas.ts';
import { extractJson, getProvider } from './ai/provider.ts';
import type { ProjectStore } from './store.ts';

/** 节点底层事实指纹：引用的文件内容没变，解释就永远不用重新生成（成本控制核心） */
export function factsHashFor(node: BizNode, files: Record<string, FileFact>): string {
  const parts = node.sourceRefs.map(r => `${r.file}:${r.symbol ?? ''}:${files[r.file]?.hash ?? 'gone'}`);
  return crypto.createHash('sha1').update(node.title + parts.join('|')).digest('hex').slice(0, 16);
}

export function findNode(store: ProjectStore, nodeId: string): { node: BizNode; viewKind: ViewKind } | null {
  const views = store.getViews();
  if (!views) return null;
  for (const view of views.views) {
    const node = view.nodes.find(n => n.id === nodeId);
    if (node) return { node, viewKind: view.kind };
  }
  return null;
}

/** 取解释：缓存命中且事实没变 → 直接返回；否则生成 */
export async function getOrGenerateExplanation(store: ProjectStore, nodeId: string): Promise<NodeExplanation> {
  const files = store.getFiles();
  const found = findNode(store, nodeId);
  if (!found) throw new Error(`节点不存在：${nodeId}`);
  const hash = factsHashFor(found.node, files);
  const cache = store.getExplanations();
  const cached = cache[nodeId];
  if (cached && cached.factsHash === hash) return cached;
  const [explanation] = await generateExplanations(store, [found.node], files);
  return explanation;
}

/** 批量生成（一次 AI 调用处理多个节点，摊薄系统提示开销） */
export async function generateExplanations(store: ProjectStore, nodes: BizNode[], files: Record<string, FileFact>): Promise<NodeExplanation[]> {
  const provider = getProvider();
  const batch = nodes.slice(0, 8); // 单次调用上限，防 prompt 爆炸
  const prompt = buildExplainPrompt(store.projectRoot, batch, files, store);

  let result = await provider.generate({ prompt, timeoutMs: 5 * 60_000 });
  if (result.isError) throw new Error(result.errorMessage ?? '解释生成失败');
  let parsed = tryParseBatch(result.text);
  if (!parsed.ok) {
    result = await provider.generate({
      prompt: `${prompt}\n\n上次输出解析失败：${parsed.error}。请严格输出合法 JSON。`,
      timeoutMs: 5 * 60_000,
    });
    if (result.isError) throw new Error(result.errorMessage ?? '解释生成失败');
    parsed = tryParseBatch(result.text);
    if (!parsed.ok) throw new Error(`解释输出两次校验失败：${parsed.error}`);
  }

  const cache = store.getExplanations();
  const out: NodeExplanation[] = [];
  for (const node of batch) {
    const e = parsed.data.explanations.find(x => x.nodeId === node.id);
    if (!e) continue;
    const explanation: NodeExplanation = {
      ...e,
      factsHash: factsHashFor(node, files),
      generatedAt: new Date().toISOString(),
    };
    cache[node.id] = explanation;
    out.push(explanation);
  }
  store.saveExplanations(cache);
  if (out.length === 0) throw new Error('AI 返回的解释与请求的节点对不上');
  return out;
}

function tryParseBatch(text: string): { ok: true; data: { explanations: import('../shared/schemas.ts').ExplanationPayload[] } } | { ok: false; error: string } {
  try {
    const json = extractJson(text);
    const parsed = ExplanationBatchSchema.safeParse(json);
    if (!parsed.success) return { ok: false, error: parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
    return { ok: true, data: parsed.data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** 节点相关源码切片（symbol 有行号就切函数体，没有就取文件头） */
export function sourceSlices(root: string, node: BizNode, files: Record<string, FileFact>, budgetChars = 12_000): string {
  const chunks: string[] = [];
  let used = 0;
  for (const ref of node.sourceRefs) {
    const fact = files[ref.file];
    if (!fact) continue;
    let content: string;
    try { content = fs.readFileSync(path.join(root, ref.file), 'utf8'); } catch { continue; }
    const allLines = content.split('\n');
    let slice: string[];
    let startLine = 1;
    if (ref.startLine && ref.endLine) {
      startLine = Math.max(1, ref.startLine - 3);
      slice = allLines.slice(startLine - 1, Math.min(allLines.length, ref.endLine + 3));
    } else {
      slice = allLines.slice(0, 90);
    }
    const numbered = slice.map((l, i) => `${startLine + i}| ${l}`).join('\n');
    const chunk = `--- ${ref.file}${ref.symbol ? ` (${ref.symbol})` : ''} ---\n${numbered}`;
    if (used + chunk.length > budgetChars) break;
    chunks.push(chunk);
    used += chunk.length;
  }
  return chunks.join('\n\n');
}

function buildExplainPrompt(root: string, nodes: BizNode[], files: Record<string, FileFact>, store: ProjectStore): string {
  const views = store.getViews();
  const nodeBlocks = nodes.map(node => {
    // 该节点在图里的邻居（依赖关系的事实依据）
    const neighbors: string[] = [];
    if (views) {
      for (const view of views.views) {
        for (const e of view.edges) {
          if (e.source === node.id) {
            const t = view.nodes.find(n => n.id === e.target);
            if (t) neighbors.push(`→ ${t.title}${e.label ? `（${e.label}）` : ''}`);
          }
          if (e.target === node.id) {
            const s = view.nodes.find(n => n.id === e.source);
            if (s) neighbors.push(`← ${s.title}${e.label ? `（${e.label}）` : ''}`);
          }
        }
      }
    }
    return `## 节点 ${node.id}
标题：${node.title}
概要：${node.summary}
图中关系：${neighbors.slice(0, 8).join('；') || '无'}
相关源码：
${sourceSlices(root, node, files)}`;
  }).join('\n\n');

  return `你是把代码翻译给"完全不懂编程的人"的解说员。请为下面 ${nodes.length} 个环节各生成一份通俗解释。

${nodeBlocks}

输出严格 JSON：
{
  "explanations": [
    {
      "nodeId": "对应上面的节点id",
      "what": "这个环节是干什么的（1-3句）",
      "when": "用户什么时候会遇到它",
      "inputs": "它接收什么（用日常语言）",
      "outputs": "它会产生什么结果",
      "onError": "出错时用户会看到什么",
      "dependsOn": "它依赖哪些其他环节",
      "impact": "修改它可能影响哪里",
      "pseudocode": ["第1步 ...", "第2步 ...", "...最多12行，每行是一步自然语言"]
    }
  ]
}

要求：全部中文，禁止出现 函数/类/组件/路由/hook/中间件/API 等术语（可以说"服务器""页面""按钮""保存"）。伪代码用"如果…就…""向服务器要…""把…显示出来"这种句式。解释必须基于给出的源码事实，不许编造。`;
}

/** 节点问答（复用会话省 token） */
export async function askNode(store: ProjectStore, nodeId: string, question: string): Promise<{ answer: string; costUsd: number }> {
  const files = store.getFiles();
  const found = findNode(store, nodeId);
  if (!found) throw new Error(`节点不存在：${nodeId}`);
  const provider = getProvider();
  const sessions = store.getSessions();
  const prior = sessions[nodeId];

  const context = prior ? '' : `背景：用户在看一个代码项目的可视化地图，正在查看「${found.node.title}」环节（${found.node.summary}）。相关源码：\n${sourceSlices(store.projectRoot, found.node, files, 9000)}\n\n`;
  const prompt = `${context}用户的提问：${question}\n\n要求：只回答与这个环节相关的内容，用完全不懂编程的人能懂的中文，3-6句话，别贴代码。`;

  const result = await provider.generate({ prompt, resumeSession: prior, timeoutMs: 3 * 60_000 });
  if (result.isError) {
    // 旧会话可能已失效，清掉重试一次
    if (prior) {
      delete sessions[nodeId];
      store.saveSessions(sessions);
      return askNode(store, nodeId, question);
    }
    throw new Error(result.errorMessage ?? '问答失败');
  }
  if (result.sessionId) {
    sessions[nodeId] = result.sessionId;
    store.saveSessions(sessions);
  }
  return { answer: result.text, costUsd: result.costUsd };
}
