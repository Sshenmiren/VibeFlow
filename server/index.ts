import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFull, analyzeIncremental } from './analyzer.ts';
import { bizNodesTouchingFiles, buildTechGraph, computeImpact } from './graph.ts';
import { askNode, generateExplanations, getOrGenerateExplanation, factsHashFor } from './explain.ts';
import {
  acceptChangeSet, createChangeSet, createDraftChangeSet, ensureGitRepo, executeChangeSet,
  isWorkingTreeClean, refineChangeSet, rollbackChangeSet, snapshotCommit,
} from './modify.ts';
import type { Blueprint, ViewLayouts } from '../shared/types.ts';
import { addToRegistry, getSettings, listRegistry, ProjectStore, projectIdFor, saveSettings } from './store.ts';
import { generateViews, refreshStaleViews } from './views.ts';
import { emit, subscribe } from './sse.ts';
import { watchProject, type ProjectWatcher } from './watcher.ts';

const PORT = Number(process.env.PORT ?? 5177);
// 默认只监听本机回环——这是操作你源码的工具，绝不能暴露到局域网
const HOST = process.env.HOST ?? '127.0.0.1';
const here = path.dirname(fileURLToPath(import.meta.url));

// ---------- 项目会话管理 ----------

interface ProjectSession {
  store: ProjectStore;
  watcher: ProjectWatcher | null;
  analyzing: boolean;
  generatingViews: boolean;
}

const sessions = new Map<string, ProjectSession>();

function getSession(id: string): ProjectSession {
  const existing = sessions.get(id);
  if (existing) return existing;
  const entry = listRegistry().find(r => r.id === id);
  if (!entry || !fs.existsSync(entry.path)) throw new HttpError(404, '项目不存在或路径已失效');
  const session: ProjectSession = {
    store: new ProjectStore(entry.path),
    watcher: null,
    analyzing: false,
    generatingViews: false,
  };
  sessions.set(id, session);
  startWatcher(id, session);
  return session;
}

function startWatcher(id: string, session: ProjectSession) {
  if (session.watcher) return;
  session.watcher = watchProject(session.store.projectRoot, (relPaths) => {
    void handleFileChanges(id, session, relPaths);
  });
}

/** 增量同步核心：文件变了（无论谁改的）→ 只重析变化部分 → 通知前端 */
async function handleFileChanges(id: string, session: ProjectSession, relPaths: string[]) {
  if (session.analyzing) return;
  session.analyzing = true;
  try {
    const meta = session.store.getMeta();
    if (!meta) return;
    const { meta: updated, changed } = await analyzeIncremental(session.store, meta, relPaths);
    if (changed.length === 0) return;
    const views = session.store.getViews();
    const staleNodeIds = bizNodesTouchingFiles(views, changed);
    session.store.addPendingStale(changed, staleNodeIds);
    const event = session.store.addTimelineEvent({
      kind: 'files-changed',
      title: `检测到 ${changed.length} 个文件变化`,
      detail: changed.slice(0, 6).join('、') + (changed.length > 6 ? ` 等 ${changed.length} 个` : ''),
      files: changed,
    });
    emit({ type: 'timeline', projectId: id, event });
    emit({ type: 'files:changed', projectId: id, files: changed, staleNodeIds });
    emit({ type: 'analysis:done', projectId: id, version: updated.analysisVersion });
  } catch (err) {
    console.error('增量分析失败：', err);
  } finally {
    session.analyzing = false;
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Express 5 的 params 类型是 string | string[]，统一取 string */
const p = (req: Request, key: string): string => String(req.params[key]);

// ---------- HTTP ----------

const app = express();
app.use(express.json({ limit: '2mb' }));

const wrap = (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);

// 注册表 & 设置
app.get('/api/registry', wrap((_req, res) => {
  const entries = listRegistry().filter(r => fs.existsSync(r.path));
  res.json(entries);
}));

app.get('/api/settings', wrap((_req, res) => { res.json(getSettings()); }));
app.put('/api/settings', wrap((req, res) => {
  const cur = getSettings();
  const { provider, model, openaiBaseUrl } = req.body as Record<string, string>;
  if (provider && !['claude-cli', 'openai-compat'].includes(provider)) throw new HttpError(400, '无效 provider');
  saveSettings({
    ...cur,
    provider: (provider as 'claude-cli' | 'openai-compat') ?? cur.provider,
    model: model ?? cur.model,
    openaiBaseUrl: openaiBaseUrl ?? cur.openaiBaseUrl,
  });
  res.json(getSettings());
}));

// 导入项目
app.post('/api/projects', wrap(async (req, res) => {
  const rawPath = String((req.body as { path?: string }).path ?? '').trim();
  if (!rawPath) throw new HttpError(400, '请提供项目路径');
  const absPath = path.resolve(rawPath);
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
    throw new HttpError(400, `路径不存在或不是文件夹：${absPath}`);
  }
  const id = projectIdFor(absPath);
  const name = path.basename(absPath);
  addToRegistry({ id, path: absPath, name });

  const store = new ProjectStore(absPath);
  const gitInfo = await ensureGitRepo(absPath);

  let meta = store.getMeta();
  if (!meta) {
    meta = {
      id, path: absPath, name,
      techStack: [], importedAt: new Date().toISOString(),
      analysisVersion: 0, analyzedAt: null, gitCommit: null,
      fileCount: 0, status: 'analyzing',
    };
    store.saveMeta(meta);
    store.addTimelineEvent({
      kind: 'import',
      title: `导入项目 ${name}`,
      detail: gitInfo.initialized ? '（此前不是 Git 仓库，已自动初始化并创建初始快照）' : undefined,
    });
  }

  const session: ProjectSession = sessions.get(id) ?? { store, watcher: null, analyzing: false, generatingViews: false };
  sessions.set(id, session);
  startWatcher(id, session);

  // 异步全量分析，进度走 SSE
  if (!session.analyzing) {
    session.analyzing = true;
    meta.status = 'analyzing';
    store.saveMeta(meta);
    void analyzeFull(store, meta, (p) => emit({ type: 'analysis:progress', projectId: id, progress: p }))
      .then((updated) => {
        const event = store.addTimelineEvent({
          kind: 'analysis',
          title: `分析完成：${updated.fileCount} 个文件`,
          detail: `技术栈：${updated.techStack.join('、') || '未识别'}`,
        });
        emit({ type: 'timeline', projectId: id, event });
        emit({ type: 'analysis:done', projectId: id, version: updated.analysisVersion });
      })
      .catch((err: Error) => {
        const m = store.getMeta();
        if (m) { m.status = 'error'; m.error = err.message; store.saveMeta(m); }
        console.error('全量分析失败：', err);
      })
      .finally(() => { session.analyzing = false; });
  }
  res.json(store.getMeta());
}));

app.get('/api/projects/:id', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  const meta = session.store.getMeta();
  if (!meta) throw new HttpError(404, '项目未分析');
  res.json(meta);
}));

app.post('/api/projects/:id/reanalyze', wrap(async (req, res) => {
  const id = p(req, 'id');
  const session = getSession(id);
  if (session.analyzing) throw new HttpError(409, '正在分析中');
  const meta = session.store.getMeta();
  if (!meta) throw new HttpError(404, '项目未导入');
  session.analyzing = true;
  try {
    const updated = await analyzeFull(session.store, meta, (p) => emit({ type: 'analysis:progress', projectId: id, progress: p }));
    emit({ type: 'analysis:done', projectId: id, version: updated.analysisVersion });
    res.json(updated);
  } finally {
    session.analyzing = false;
  }
}));

// 图与视图
app.get('/api/projects/:id/graph', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  res.json(buildTechGraph(session.store.getFiles()));
}));

app.get('/api/projects/:id/views', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  res.json(session.store.getViews());
}));

app.post('/api/projects/:id/views/generate', wrap(async (req, res) => {
  const session = getSession(p(req, 'id'));
  if (session.generatingViews) throw new HttpError(409, '正在生成中，请稍候');
  const meta = session.store.getMeta();
  if (!meta || meta.status === 'analyzing') throw new HttpError(409, '请等分析完成');
  if (meta.fileCount === 0) throw new HttpError(400, '项目还没有可分析的文件');
  session.generatingViews = true;
  try {
    const views = await generateViews(session.store, meta);
    emit({ type: 'timeline', projectId: p(req, 'id'), event: session.store.getTimeline()[0] });
    res.json(views);
  } finally {
    session.generatingViews = false;
  }
}));

// 过期状态（服务端持久化，刷新页面不丢）
app.get('/api/projects/:id/stale', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  res.json(session.store.getPendingStale());
}));

// 增量刷新：只重新翻译受变化影响的视图
app.post('/api/projects/:id/views/refresh', wrap(async (req, res) => {
  const session = getSession(p(req, 'id'));
  if (session.generatingViews) throw new HttpError(409, '正在生成中，请稍候');
  const meta = session.store.getMeta();
  if (!meta) throw new HttpError(404, '项目未导入');
  session.generatingViews = true;
  try {
    const views = await refreshStaleViews(session.store, meta);
    emit({ type: 'timeline', projectId: p(req, 'id'), event: session.store.getTimeline()[0] });
    res.json(views);
  } finally {
    session.generatingViews = false;
  }
}));

// 解释层
app.get('/api/projects/:id/nodes/:nodeId/explanation', wrap(async (req, res) => {
  const session = getSession(p(req, 'id'));
  const explanation = await getOrGenerateExplanation(session.store, p(req, 'nodeId'));
  res.json(explanation);
}));

app.post('/api/projects/:id/views/:kind/explain-all', wrap(async (req, res) => {
  const session = getSession(p(req, 'id'));
  const views = session.store.getViews();
  const view = views?.views.find(v => v.kind === p(req, 'kind'));
  if (!view) throw new HttpError(404, '视图不存在');
  const files = session.store.getFiles();
  const cache = session.store.getExplanations();
  const missing = view.nodes.filter(n => cache[n.id]?.factsHash !== factsHashFor(n, files));
  let generated = 0;
  for (let i = 0; i < missing.length; i += 8) {
    const batch = missing.slice(i, i + 8);
    await generateExplanations(session.store, batch, files);
    generated += batch.length;
  }
  res.json({ generated, cached: view.nodes.length - missing.length });
}));

app.post('/api/projects/:id/nodes/:nodeId/ask', wrap(async (req, res) => {
  const session = getSession(p(req, 'id'));
  const question = String((req.body as { question?: string }).question ?? '').trim();
  if (!question) throw new HttpError(400, '问题不能为空');
  const result = await askNode(session.store, p(req, 'nodeId'), question);
  res.json(result);
}));

// 影响范围 / 源码 / 时间线
app.get('/api/projects/:id/impact/:nodeId', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  res.json(computeImpact(p(req, 'nodeId'), session.store.getViews(), session.store.getFiles()));
}));

app.get('/api/projects/:id/file', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  const rel = String(req.query.path ?? '');
  const abs = path.resolve(session.store.projectRoot, rel);
  if (!abs.startsWith(path.resolve(session.store.projectRoot))) throw new HttpError(400, '非法路径');
  if (!fs.existsSync(abs)) throw new HttpError(404, '文件不存在');
  const content = fs.readFileSync(abs, 'utf8');
  res.json({ path: rel, content: content.length > 200_000 ? content.slice(0, 200_000) + '\n…(过长截断)' : content });
}));

app.get('/api/projects/:id/timeline', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  res.json(session.store.getTimeline());
}));

// 用户拖动的节点位置（按视图持久化，箭头随 React Flow 自动跟随）
app.get('/api/projects/:id/layout', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  res.json(session.store.getLayouts());
}));

app.put('/api/projects/:id/layout', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  const body = req.body as { view?: string; positions?: Record<string, { x: number; y: number }> };
  if (!body.view || !body.positions) throw new HttpError(400, '缺少 view/positions');
  const layouts: ViewLayouts = session.store.getLayouts();
  layouts[body.view] = { ...layouts[body.view], ...body.positions };
  session.store.saveLayouts(layouts);
  res.json({ ok: true });
}));

// 构建蓝图：自由画布 → 打包发给 AI
app.get('/api/projects/:id/blueprint', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  res.json(session.store.getBlueprint());
}));

app.put('/api/projects/:id/blueprint', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  const body = req.body as Blueprint;
  if (!Array.isArray(body.blocks) || !Array.isArray(body.connections)) throw new HttpError(400, '蓝图格式不对');
  session.store.saveBlueprint({
    blocks: body.blocks.slice(0, 60),
    connections: body.connections.slice(0, 120),
    updatedAt: new Date().toISOString(),
  });
  res.json({ ok: true });
}));

app.post('/api/projects/:id/blueprint/send', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  const view = String((req.body as { view?: string }).view ?? '');
  if (!view) throw new HttpError(400, '缺少 view');
  const cs = createDraftChangeSet(session.store, session.store.getBlueprint(), view);
  emit({ type: 'changeset', projectId: p(req, 'id'), changeSet: cs });
  res.json(cs);
}));

// 修改闭环
app.get('/api/projects/:id/changesets', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  res.json(session.store.getChangeSets());
}));

app.post('/api/projects/:id/nodes/:nodeId/modify', wrap((req, res) => {
  const session = getSession(p(req, 'id'));
  const instruction = String((req.body as { instruction?: string }).instruction ?? '').trim();
  if (!instruction) throw new HttpError(400, '请描述你想要的修改');
  const cs = createChangeSet(session.store, p(req, 'nodeId'), instruction);
  emit({ type: 'changeset', projectId: p(req, 'id'), changeSet: cs });
  res.json(cs);
}));

app.post('/api/projects/:id/changesets/:csId/execute', wrap(async (req, res) => {
  const id = p(req, 'id');
  const session = getSession(id);
  if (!(await isWorkingTreeClean(session.store.projectRoot))) {
    throw new HttpError(409, 'DIRTY_TREE');
  }
  // 长任务：立即返回，进度走 SSE；执行期间暂停 watcher 防止自触发
  res.status(202).json({ started: true });
  session.watcher?.pause();
  const csId = p(req, 'csId');
  try {
    const cs = await executeChangeSet(session.store, csId, (updated) => {
      emit({ type: 'changeset', projectId: id, changeSet: { ...updated } });
    }, (line) => {
      emit({ type: 'modify:log', projectId: id, csId, line });
    });
    await reanalyzeChanged(session, id, cs.changedFiles);
  } catch (err) {
    console.error('执行修改失败：', err);
  } finally {
    session.watcher?.resume();
  }
}));

// 对话式继续调整：看过 diff 后在同一 AI 会话上追加要求
app.post('/api/projects/:id/changesets/:csId/refine', wrap(async (req, res) => {
  const id = p(req, 'id');
  const session = getSession(id);
  const instruction = String((req.body as { instruction?: string }).instruction ?? '').trim();
  if (!instruction) throw new HttpError(400, '请描述要怎么调整');
  res.status(202).json({ started: true });
  session.watcher?.pause();
  const csId = p(req, 'csId');
  try {
    const cs = await refineChangeSet(session.store, csId, instruction, (updated) => {
      emit({ type: 'changeset', projectId: id, changeSet: { ...updated } });
    }, (line) => {
      emit({ type: 'modify:log', projectId: id, csId, line });
    });
    await reanalyzeChanged(session, id, cs.changedFiles);
  } catch (err) {
    console.error('继续调整失败：', err);
  } finally {
    session.watcher?.resume();
  }
}));

/** 修改落盘后（尚未 commit）增量更新地图 */
async function reanalyzeChanged(session: ProjectSession, id: string, files: string[]) {
  if (files.length === 0) return;
  const meta = session.store.getMeta();
  if (!meta) return;
  const { changed } = await analyzeIncremental(session.store, meta, files);
  if (changed.length) {
    const staleNodeIds = bizNodesTouchingFiles(session.store.getViews(), changed);
    session.store.addPendingStale(changed, staleNodeIds);
    emit({ type: 'files:changed', projectId: id, files: changed, staleNodeIds });
  }
}

app.post('/api/projects/:id/changesets/:csId/accept', wrap(async (req, res) => {
  const session = getSession(p(req, 'id'));
  const cs = await acceptChangeSet(session.store, p(req, 'csId'));
  const meta = session.store.getMeta();
  if (meta) {
    const { meta: m2 } = await analyzeIncremental(session.store, meta, cs.changedFiles);
    void m2;
  }
  emit({ type: 'changeset', projectId: p(req, 'id'), changeSet: cs });
  emit({ type: 'timeline', projectId: p(req, 'id'), event: session.store.getTimeline()[0] });
  res.json(cs);
}));

app.post('/api/projects/:id/changesets/:csId/rollback', wrap(async (req, res) => {
  const session = getSession(p(req, 'id'));
  session.watcher?.pause();
  try {
    const cs = await rollbackChangeSet(session.store, p(req, 'csId'));
    const meta = session.store.getMeta();
    if (meta && cs.changedFiles.length) {
      const { changed } = await analyzeIncremental(session.store, meta, cs.changedFiles);
      if (changed.length) {
        emit({ type: 'files:changed', projectId: p(req, 'id'), files: changed, staleNodeIds: bizNodesTouchingFiles(session.store.getViews(), changed) });
      }
    }
    emit({ type: 'changeset', projectId: p(req, 'id'), changeSet: cs });
    emit({ type: 'timeline', projectId: p(req, 'id'), event: session.store.getTimeline()[0] });
    res.json(cs);
  } finally {
    session.watcher?.resume();
  }
}));

app.post('/api/projects/:id/snapshot', wrap(async (req, res) => {
  const session = getSession(p(req, 'id'));
  await snapshotCommit(session.store.projectRoot);
  const event = session.store.addTimelineEvent({ kind: 'note', title: '已把当前改动保存为快照' });
  emit({ type: 'timeline', projectId: p(req, 'id'), event });
  res.json({ ok: true });
}));

// SSE
app.get('/api/projects/:id/events', (req, res) => {
  try {
    getSession(p(req, 'id'));
    subscribe(p(req, 'id'), res);
  } catch {
    res.status(404).end();
  }
});

// 生产模式：托管前端构建产物
const distDir = path.resolve(here, '../client/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// 统一错误处理
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message });
});

app.listen(PORT, HOST, () => {
  console.log(`vibeflow server → http://localhost:${PORT}`);
});
