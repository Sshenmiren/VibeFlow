import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';

export interface ProjectWatcher {
  pause(): void;
  resume(): void;
  close(): Promise<void>;
}

const IGNORED_SEGMENTS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '__pycache__',
  '.venv', 'venv', 'coverage', '.vibeflow', '.idea', '.vscode', '.claude',
]);

/**
 * 监听项目文件变化（无论谁改的 —— 编辑器、另一个终端里的 Claude Code、git 操作）。
 * 变化去抖合并成批（npm install/git checkout 风暴只触发一次增量分析）。
 */
export function watchProject(root: string, onBatch: (relPaths: string[]) => void): ProjectWatcher {
  let paused = false;
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  const watcher: FSWatcher = chokidar.watch(root, {
    ignored: (p: string) => p.split(/[\\/]/).some(seg => IGNORED_SEGMENTS.has(seg)),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });

  const onEvent = (absPath: string) => {
    if (paused) return;
    const rel = path.relative(root, absPath).split(path.sep).join('/');
    if (!rel || rel.startsWith('..')) return;
    pending.add(rel);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 900);
  };

  const flush = () => {
    timer = null;
    if (paused || pending.size === 0) return;
    const batch = [...pending];
    pending = new Set();
    onBatch(batch);
  };

  watcher.on('add', onEvent);
  watcher.on('change', onEvent);
  watcher.on('unlink', onEvent);

  return {
    pause() { paused = true; pending.clear(); },
    resume() { paused = false; },
    async close() { if (timer) clearTimeout(timer); await watcher.close(); },
  };
}
