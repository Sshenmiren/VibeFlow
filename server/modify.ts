import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { simpleGit, type SimpleGit } from 'simple-git';
import type { Blueprint, ChangeSet, TestRun } from '../shared/types.ts';
import { getProvider } from './ai/provider.ts';
import { computeImpact } from './graph.ts';
import { findNode, sourceSlices } from './explain.ts';
import type { ProjectStore } from './store.ts';

function git(root: string): SimpleGit { return simpleGit(root); }

export async function ensureGitRepo(root: string): Promise<{ initialized: boolean }> {
  const g = git(root);
  if (await g.checkIsRepo()) {
    excludeStoreDir(root);
    await ensureGitIdentity(g);
    return { initialized: false };
  }
  await g.init();
  excludeStoreDir(root);
  await ensureGitIdentity(g);
  await g.add('-A');
  await g.commit('whatdidaido: 初始快照（导入项目时自动创建）');
  return { initialized: true };
}

/** 机器上没配 git 身份时，给仓库设一个局部身份，否则 commit 会失败 */
async function ensureGitIdentity(g: SimpleGit) {
  try {
    const email = (await g.raw(['config', 'user.email'])).trim();
    if (email) return;
  } catch { /* 未配置 → 落到下面 */ }
  await g.addConfig('user.name', 'whatdidaido', false, 'local');
  await g.addConfig('user.email', 'whatdidaido@local', false, 'local');
}

/** 用 .git/info/exclude 忽略我们的存储目录（不动用户的 .gitignore） */
function excludeStoreDir(root: string) {
  try {
    const excludeFile = path.join(root, '.git', 'info', 'exclude');
    const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : '';
    if (!current.includes('.whatdidaido')) {
      fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
      fs.writeFileSync(excludeFile, current + '\n.whatdidaido/\n');
    }
  } catch { /* 非致命 */ }
}

export async function isWorkingTreeClean(root: string): Promise<boolean> {
  const status = await git(root).status();
  return status.isClean();
}

/** 把当前所有改动提交为快照（修改前的安全垫） */
export async function snapshotCommit(root: string): Promise<void> {
  const g = git(root);
  await g.add('-A');
  await g.commit('whatdidaido: 修改前快照');
}

// ---------- 修改计划（纯静态，零 AI 成本） ----------

export function createChangeSet(store: ProjectStore, nodeId: string, instruction: string): ChangeSet {
  const found = findNode(store, nodeId);
  if (!found) throw new Error(`节点不存在：${nodeId}`);
  const files = store.getFiles();
  const views = store.getViews();
  const impact = computeImpact(nodeId, views, files);

  const cs: ChangeSet = {
    id: crypto.randomUUID().slice(0, 8),
    nodeId,
    nodeTitle: found.node.title,
    instruction,
    status: 'planned',
    plan: {
      files: impact.files,
      affectedNodeIds: [nodeId, ...impact.relatedBizNodes.map(n => n.id)],
      note: `AI 将从这些文件入手（可能按需触及其他文件）；改动完成后会展示完整 diff 供你确认。下游可能波及 ${impact.dependents.length} 个文件、${impact.relatedBizNodes.length} 个相关环节。`,
    },
    diff: null,
    changedFiles: [],
    tests: [],
    aiCostUsd: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const all = store.getChangeSets();
  all.unshift(cs);
  store.saveChangeSets(all);
  return cs;
}

/**
 * 视图上的新构想 → 修改单。
 * 用户直接在（比如）用户旅程图上画了新模块并连到现有环节：
 * 草稿模块的文字全由用户写；连到的现有节点提供真实源码上下文（sourceRefs）。
 */
export function createDraftChangeSet(store: ProjectStore, blueprint: Blueprint, viewKind: string): ChangeSet {
  const blocks = blueprint.blocks.filter(b => b.view === viewKind);
  const cons = blueprint.connections.filter(c => c.view === viewKind);
  if (blocks.length === 0) throw new Error('这个视图上还没有画新构想——先点「＋ 突发奇想」加一个模块');

  const views = store.getViews();
  const view = views?.views.find(v => v.kind === viewKind);
  const realById = new Map((view?.nodes ?? []).map(n => [n.id, n]));
  const draftById = new Map(blocks.map(b => [b.id, b]));

  const nameOf = (id: string) => draftById.get(id)?.title || realById.get(id)?.title || '?';
  const involvedReal = new Set<string>();
  for (const c of cons) {
    if (realById.has(c.source)) involvedReal.add(c.source);
    if (realById.has(c.target)) involvedReal.add(c.target);
  }

  const lines: string[] = [
    `用户在「${view?.title ?? viewKind}」视图上勾画了一个新构想：新画的模块和每条连线的含义都是用户亲手写的，其中【现有环节】是项目里已经存在的真实功能。请把这个构想在项目里实现出来：`,
    '', '== 新模块（待实现） ==',
  ];
  blocks.forEach((b, i) => {
    lines.push(`${i + 1}. 【${b.title || '未命名模块'}】${b.desc || '（用户没写说明）'}`);
  });
  if (cons.length > 0) {
    lines.push('', '== 连线（流向/触发关系） ==');
    for (const c of cons) {
      const mark = (id: string) => realById.has(id) ? `【现有环节】${nameOf(id)}` : `「${nameOf(id)}」`;
      lines.push(`- ${mark(c.source)} → ${mark(c.target)}：${c.label || '（用户没写这条线的含义）'}`);
    }
  }
  if (involvedReal.size > 0) {
    lines.push('', '== 涉及的现有环节（真实源码位置） ==');
    for (const id of involvedReal) {
      const n = realById.get(id)!;
      lines.push(`- ${n.title}：${n.summary}；源码 → ${n.sourceRefs.map(r => r.file + (r.symbol ? `#${r.symbol}` : '')).join(', ')}`);
    }
  }
  lines.push('', '实现要求：贴合项目现有技术栈和代码风格；与现有环节的衔接必须真实接上（不是另起炉灶）；保持最小可用实现。');

  const files = [...new Set([...involvedReal].flatMap(id => realById.get(id)!.sourceRefs.map(r => r.file)))];
  const cs: ChangeSet = {
    id: crypto.randomUUID().slice(0, 8),
    nodeId: 'blueprint',
    nodeTitle: `新构想（${view?.title ?? viewKind}）`,
    instruction: lines.join('\n'),
    status: 'planned',
    plan: {
      files,
      affectedNodeIds: [...involvedReal],
      note: `将实现 ${blocks.length} 个新模块、${cons.length} 条连接${involvedReal.size ? `，并接入 ${involvedReal.size} 个现有环节` : ''}。完成后展示完整 diff 供你确认。`,
    },
    diff: null,
    changedFiles: [],
    tests: [],
    aiCostUsd: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const all = store.getChangeSets();
  all.unshift(cs);
  store.saveChangeSets(all);
  return cs;
}

// ---------- 执行：claude 改代码 → git diff ----------

export async function executeChangeSet(
  store: ProjectStore, csId: string,
  onUpdate: (cs: ChangeSet) => void,
): Promise<ChangeSet> {
  const root = store.projectRoot;
  const all = store.getChangeSets();
  const cs = all.find(c => c.id === csId);
  if (!cs) throw new Error(`修改单不存在：${csId}`);
  if (cs.status !== 'planned') throw new Error(`当前状态不能执行：${cs.status}`);

  if (!(await isWorkingTreeClean(root))) {
    throw new Error('DIRTY_TREE');
  }

  const found = findNode(store, cs.nodeId);
  const filesFacts = store.getFiles();
  update(cs, { status: 'executing' });

  const fileList = cs.plan?.files.length
    ? `这个环节对应的文件：\n${cs.plan.files.map(f => `- ${f}`).join('\n')}`
    : '没有预先定位的文件——请自行探索项目结构，把代码放在最自然的位置。';
  const context = found ? `相关源码片段（可能不完整，请自行读取完整文件）：\n${sourceSlices(root, found.node, filesFacts, 8000)}` : '';
  const prompt = `你在一个真实项目里执行一次精确的代码修改。

任务来源：「${cs.nodeTitle}」${found ? `—— ${found.node.summary}` : ''}
用户的要求（自然语言）：
${cs.instruction}

${fileList}

${context}

要求：
1. 只做用户要求的修改，保持最小改动
2. 保持项目现有代码风格
3. 不要运行任何命令、不要 git 操作、不要创建文档
4. 不要动 .whatdidaido 目录
5. 改完后简要说明你改了什么（中文，2-4句）`;

  const provider = getProvider();
  const result = await provider.generate({
    prompt,
    cwd: root,
    allowEdits: true,
    timeoutMs: 15 * 60_000,
  });

  cs.aiCostUsd += result.costUsd;
  if (result.isError) {
    update(cs, { status: 'failed', error: result.errorMessage });
    return cs;
  }

  // 捕获 diff（含新增文件）：add -A 让 untracked 进索引 → diff HEAD → reset 恢复未暂存
  const g = git(root);
  await g.add('-A');
  const diff = await g.diff(['--cached']);
  const nameOnly = (await g.diff(['--cached', '--name-only'])).split('\n').map(s => s.trim()).filter(Boolean);
  await g.reset(['HEAD']);

  if (!diff.trim()) {
    update(cs, { status: 'failed', error: `AI 没有产生任何文件改动。它说：${result.text.slice(0, 300)}` });
    return cs;
  }

  update(cs, {
    status: 'diffed',
    diff: diff.length > 400_000 ? diff.slice(0, 400_000) + '\n…(diff 过长已截断)' : diff,
    changedFiles: nameOnly,
    error: undefined,
  });
  store.addTimelineEvent({
    kind: 'modify',
    title: `AI 修改了「${cs.nodeTitle}」`,
    detail: result.text.slice(0, 200),
    files: nameOnly,
    changeSetId: cs.id,
    costUsd: result.costUsd,
  });

  // 自动跑测试
  update(cs, { status: 'testing' });
  cs.tests = await runProjectChecks(root);
  update(cs, { status: 'tested' });
  return cs;

  function update(target: ChangeSet, patch: Partial<ChangeSet>) {
    Object.assign(target, patch, { updatedAt: new Date().toISOString() });
    store.saveChangeSets(all);
    onUpdate(target);
  }
}

export async function acceptChangeSet(store: ProjectStore, csId: string): Promise<ChangeSet> {
  const all = store.getChangeSets();
  const cs = all.find(c => c.id === csId);
  if (!cs) throw new Error('修改单不存在');
  if (cs.status !== 'tested' && cs.status !== 'diffed') throw new Error(`当前状态不能接受：${cs.status}`);
  const g = git(store.projectRoot);
  await g.add('-A');
  await g.commit(`whatdidaido: ${cs.instruction.slice(0, 60)}`);
  cs.status = 'accepted';
  cs.updatedAt = new Date().toISOString();
  store.saveChangeSets(all);
  store.addTimelineEvent({ kind: 'modify', title: `✓ 已接受修改「${cs.nodeTitle}」`, changeSetId: cs.id, files: cs.changedFiles });
  return cs;
}

export async function rollbackChangeSet(store: ProjectStore, csId: string): Promise<ChangeSet> {
  const all = store.getChangeSets();
  const cs = all.find(c => c.id === csId);
  if (!cs) throw new Error('修改单不存在');
  if (cs.status !== 'tested' && cs.status !== 'diffed' && cs.status !== 'failed') throw new Error(`当前状态不能回滚：${cs.status}`);
  const g = git(store.projectRoot);
  // 执行前保证过 working tree 干净，所以 reset+clean 恰好回到修改前
  await g.reset(['--hard', 'HEAD']);
  await g.clean('f', ['-d', '-e', '.whatdidaido']);
  cs.status = 'rolledback';
  cs.updatedAt = new Date().toISOString();
  store.saveChangeSets(all);
  store.addTimelineEvent({ kind: 'modify', title: `↩ 已回滚修改「${cs.nodeTitle}」`, changeSetId: cs.id });
  return cs;
}

// ---------- 测试/检查运行 ----------

/** 探测项目可运行的检查命令：package.json scripts + Python 语法检查 */
export function detectChecks(root: string): { cwd: string; command: string; label: string }[] {
  const checks: { cwd: string; command: string; label: string }[] = [];
  const dirs = ['', ...safeSubdirs(root)];
  for (const dir of dirs) {
    const pkgPath = path.join(root, dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      for (const name of ['typecheck', 'test', 'build']) {
        if (scripts[name]) {
          // vite build 前常见 tsc -b：本身就含类型检查
          checks.push({ cwd: path.join(root, dir), command: `npm run ${name}`, label: `${dir || '.'}: npm run ${name}` });
        }
      }
    } catch { /* 坏 package.json */ }
  }
  // Python：语法级检查（无测试框架时的兜底）
  const pyDirs = dirs.filter(d => {
    const abs = path.join(root, d);
    try { return fs.readdirSync(abs).some(f => f.endsWith('.py')); } catch { return false; }
  });
  for (const d of pyDirs.slice(0, 2)) {
    checks.push({ cwd: root, command: `python -m compileall -q ${d || '.'}`, label: `python 语法检查 ${d || '.'}` });
  }
  return checks.slice(0, 4);
}

function safeSubdirs(root: string): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory() && !['node_modules', '.git', '.whatdidaido', 'dist'].includes(e.name))
      .map(e => e.name);
  } catch { return []; }
}

export async function runProjectChecks(root: string): Promise<TestRun[]> {
  const checks = detectChecks(root);
  const runs: TestRun[] = [];
  for (const check of checks) {
    runs.push(await runCommand(check.cwd, check.command));
  }
  return runs;
}

function runCommand(cwd: string, command: string): Promise<TestRun> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ command, ok: false, exitCode: -1, outputTail: output.slice(-2000) + '\n(超时被终止)', durationMs: Date.now() - started });
    }, 5 * 60_000);
    child.stdout.on('data', (d: Buffer) => { output += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { output += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        command,
        ok: code === 0,
        exitCode: code ?? -1,
        outputTail: output.slice(-2000),
        durationMs: Date.now() - started,
      });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ command, ok: false, exitCode: -1, outputTail: err.message, durationMs: Date.now() - started });
    });
  });
}
