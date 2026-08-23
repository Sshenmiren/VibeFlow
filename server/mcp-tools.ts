import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { BizNode, ProjectMeta, SourceRef, SymbolFact, ViewKind } from '../shared/types.ts';
import { computeImpact } from './graph.ts';
import { ProjectStore, listRegistry, projectIdFor } from './store.ts';

/**
 * MCP 工具的纯函数层：让 Claude Code 等 coding agent 直接查询项目地图，
 * 不用重新扫描整个项目。全部只读，直接读 .vibeflow 存储。
 */

export function listProjects(): { name: string; path: string; analyzed: boolean; summary?: string }[] {
  return listRegistry()
    .filter(r => fs.existsSync(r.path))
    .map(r => {
      const store = new ProjectStore(r.path);
      const views = store.getViews();
      return {
        name: r.name,
        path: r.path,
        analyzed: store.getMeta()?.status === 'ready',
        summary: views?.projectSummary,
      };
    });
}

export function getProjectSummary(store: ProjectStore) {
  const meta = store.getMeta();
  const views = store.getViews();
  return {
    name: meta?.name ?? path.basename(store.projectRoot),
    projectSummary: views?.projectSummary ?? '（还没有生成业务视图）',
    techStack: meta?.techStack ?? [],
    fileCount: meta?.fileCount ?? 0,
    gitCommit: meta?.gitCommit ?? null,
    analyzedAt: meta?.analyzedAt ?? null,
    views: (views?.views ?? []).map(v => ({ kind: v.kind, title: v.title, nodeCount: v.nodes.length })),
  };
}

export interface FeatureHit {
  id: string;
  viewKind: ViewKind;
  title: string;
  summary: string;
  sourceRefs: SourceRef[];
}

/** 按标题/概要文本搜业务节点（大小写不敏感，多关键词 AND） */
export function findFeature(store: ProjectStore, query: string): FeatureHit[] {
  const views = store.getViews();
  if (!views) return [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: FeatureHit[] = [];
  const seen = new Set<string>();
  for (const view of views.views) {
    for (const n of view.nodes) {
      const haystack = `${n.title} ${n.summary}`.toLowerCase();
      if (terms.every(t => haystack.includes(t)) && !seen.has(n.id)) {
        seen.add(n.id);
        hits.push({ id: n.id, viewKind: view.kind, title: n.title, summary: n.summary, sourceRefs: n.sourceRefs });
      }
    }
  }
  return hits.slice(0, 20);
}

/** 节点详情 + 真实源码片段 */
export function getNodeSource(store: ProjectStore, nodeId: string): { title: string; summary: string; sourceRefs: SourceRef[]; source: string } | null {
  const views = store.getViews();
  if (!views) return null;
  let node: BizNode | null = null;
  for (const v of views.views) {
    const n = v.nodes.find(x => x.id === nodeId);
    if (n) { node = n; break; }
  }
  if (!node) return null;
  const chunks: string[] = [];
  for (const ref of node.sourceRefs.slice(0, 5)) {
    try {
      const content = fs.readFileSync(path.join(store.projectRoot, ref.file), 'utf8');
      const lines = content.split('\n');
      const start = Math.max(0, (ref.startLine ?? 1) - 1);
      const end = Math.min(lines.length, ref.endLine ?? Math.min(lines.length, start + 80));
      chunks.push(`--- ${ref.file}${ref.symbol ? ` (${ref.symbol})` : ''} 第${start + 1}-${end}行 ---\n${lines.slice(start, end).join('\n')}`);
    } catch { /* 文件可能已删除 */ }
  }
  return { title: node.title, summary: node.summary, sourceRefs: node.sourceRefs, source: chunks.join('\n\n').slice(0, 20_000) };
}

/** 反查：这个文件在业务地图里扮演什么角色 */
export function getFileRole(store: ProjectStore, file: string): {
  file: string;
  symbols: Pick<SymbolFact, 'name' | 'kind' | 'route' | 'startLine'>[];
  usedByNodes: { id: string; viewKind: ViewKind; title: string; summary: string }[];
  importedBy: string[];
} {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  const files = store.getFiles();
  const fact = files[normalized];
  const views = store.getViews();
  const usedByNodes: { id: string; viewKind: ViewKind; title: string; summary: string }[] = [];
  for (const view of views?.views ?? []) {
    for (const n of view.nodes) {
      if (n.sourceRefs.some(r => r.file === normalized)) {
        usedByNodes.push({ id: n.id, viewKind: view.kind, title: n.title, summary: n.summary });
      }
    }
  }
  const importedBy = Object.values(files)
    .filter(f => f.imports.some(i => i.resolved === normalized))
    .map(f => f.path);
  return {
    file: normalized,
    symbols: (fact?.symbols ?? []).map(s => ({ name: s.name, kind: s.kind, route: s.route, startLine: s.startLine })),
    usedByNodes,
    importedBy,
  };
}

/** 影响范围（复用主分析器的实现） */
export function getImpact(store: ProjectStore, nodeIdOrFile: string) {
  const nodeId = nodeIdOrFile.includes(':') ? nodeIdOrFile : `file:${nodeIdOrFile.replace(/\\/g, '/')}`;
  return computeImpact(nodeId, store.getViews(), store.getFiles());
}

/** 把用户给的路径解析成 ProjectStore（必须已被 VibeFlow 分析过） */
export function resolveStore(projectPath: string): ProjectStore {
  const abs = path.resolve(projectPath);
  const store = new ProjectStore(abs);
  if (!store.getMeta()) {
    throw new Error(`这个路径还没被 VibeFlow 分析过：${abs}。先在 VibeFlow 面板里导入它。`);
  }
  return store;
}

// ---------- open_webui：在浏览器一键打开 WebUI 并指向指定项目 ----------

const PORT = Number(process.env.PORT ?? 5177);
const BASE = `http://127.0.0.1:${PORT}`;
const repoRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 探测 5177 是否已有 VibeFlow 在跑（/api/registry 能返回即视为在跑） */
async function isServerUp(): Promise<boolean> {
  try {
    const ctrl = AbortSignal.timeout(1000);
    const res = await fetch(`${BASE}/api/registry`, { signal: ctrl });
    return res.ok;
  } catch {
    return false;
  }
}

/** detached 起生产模式服务，脱离 MCP 父进程独立存活；必要时先构建前端 */
function startServerDetached() {
  const root = repoRoot();
  if (!fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
    // 生产模式需要打包好的前端，首次构建（同步，一次性）
    spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'ignore', shell: true });
  }
  const child = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    shell: true,
    env: { ...process.env, NODE_ENV: 'production' },
  });
  child.unref();
}

/** 跨平台打开浏览器，不引依赖 */
function openBrowser(url: string) {
  const plat = os.platform();
  const cmd = plat === 'win32' ? 'start' : plat === 'darwin' ? 'open' : 'xdg-open';
  // win 下 start 首个引号参数会被当成窗口标题，补一个空标题
  const args = plat === 'win32' ? ['', url] : [url];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', shell: true });
  child.unref();
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * 一键打开 WebUI 并直达指定项目。
 * 供 MCP 工具调用（首个有副作用的工具）：探测/启动服务 → 导入项目 → 开浏览器深链。
 */
export async function openWebui(projectPath: string): Promise<{ url: string; name: string; startedServer: boolean }> {
  const abs = path.resolve(projectPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`路径不存在或不是文件夹：${abs}`);
  }

  let startedServer = false;
  if (!(await isServerUp())) {
    startServerDetached();
    startedServer = true;
    // 轮询直到就绪（最多 ~30s：构建+启动可能较慢）
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await sleep(1000);
      if (await isServerUp()) break;
    }
    if (!(await isServerUp())) {
      throw new Error('VibeFlow 服务启动超时，请手动在仓库目录运行 npm start 后重试。');
    }
  }

  // 复用服务端完整导入逻辑（addToRegistry + 全量分析），拿到项目 id
  const res = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: abs }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `导入失败 ${res.status}`);
  }
  const meta = await res.json() as ProjectMeta;

  const url = `${BASE}/?open=${meta.id ?? projectIdFor(abs)}`;
  openBrowser(url);
  return { url, name: meta.name ?? path.basename(abs), startedServer };
}
