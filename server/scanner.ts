import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

/** 永远排除的目录/文件（不管 .gitignore 写没写） */
const ALWAYS_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.output',
  '__pycache__', '.venv', 'venv', 'env', '.pytest_cache', '.mypy_cache',
  'coverage', '.vibeflow', '.idea', '.vscode', '.claude',
]);

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tar', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.pyc', '.wasm',
  '.db', '.sqlite', '.lock',
]);

const SECRET_FILES = /^\.env(\..+)?$|credentials|secret/i;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB

export interface ScannedFile {
  relPath: string; // posix
  absPath: string;
  size: number;
}

export function scanProject(root: string): ScannedFile[] {
  const ig = loadGitignore(root);
  const results: ScannedFile[] = [];
  walk(root, '');

  function walk(absDir: string, relDir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (ALWAYS_EXCLUDE_DIRS.has(entry.name)) continue;
        if (ig.ignores(rel + '/')) continue;
        walk(path.join(absDir, entry.name), rel);
      } else if (entry.isFile()) {
        if (ig.ignores(rel)) continue;
        if (BINARY_EXT.has(path.extname(entry.name).toLowerCase())) continue;
        if (SECRET_FILES.test(entry.name)) continue;
        if (/package-lock\.json|yarn\.lock|pnpm-lock/.test(entry.name)) continue;
        let size: number;
        try { size = fs.statSync(path.join(absDir, entry.name)).size; } catch { continue; }
        if (size > MAX_FILE_SIZE) continue;
        results.push({ relPath: rel, absPath: path.join(absDir, entry.name), size });
      }
    }
  }
  return results;
}

function loadGitignore(root: string): Ignore {
  const ig = ignore();
  try {
    const content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    ig.add(content);
  } catch { /* 没有 .gitignore */ }
  return ig;
}

/** 单文件是否在分析范围内（watcher 用） */
export function isAnalyzable(root: string, relPath: string): boolean {
  const parts = relPath.split('/');
  if (parts.some(p => ALWAYS_EXCLUDE_DIRS.has(p))) return false;
  const name = parts[parts.length - 1];
  if (BINARY_EXT.has(path.extname(name).toLowerCase())) return false;
  if (SECRET_FILES.test(name)) return false;
  if (/package-lock\.json|yarn\.lock|pnpm-lock/.test(name)) return false;
  const ig = loadGitignore(root);
  return !ig.ignores(relPath);
}

/** 技术栈识别：读依赖声明 + 文件特征 */
export function detectTechStack(root: string, filePaths: string[]): string[] {
  const stack = new Set<string>();
  const readJson = (p: string): Record<string, unknown> | null => {
    try { return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); } catch { return null; }
  };

  for (const p of filePaths.filter(f => f.endsWith('package.json'))) {
    const pkg = readJson(p);
    if (!pkg) continue;
    const deps = { ...(pkg.dependencies as object ?? {}), ...(pkg.devDependencies as object ?? {}) } as Record<string, string>;
    const known: [string, string][] = [
      ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['@angular/core', 'Angular'],
      ['vite', 'Vite'], ['next', 'Next.js'], ['express', 'Express'], ['fastify', 'Fastify'],
      ['koa', 'Koa'], ['electron', 'Electron'], ['tailwindcss', 'Tailwind'],
      ['typescript', 'TypeScript'], ['zustand', 'Zustand'], ['axios', 'Axios'],
    ];
    for (const [dep, label] of known) if (deps[dep]) stack.add(label);
  }

  const pyReq = filePaths.find(f => /requirements.*\.txt$|pyproject\.toml$/.test(f));
  if (pyReq || filePaths.some(f => f.endsWith('.py'))) {
    stack.add('Python');
    try {
      const content = fs.readFileSync(path.join(root, pyReq ?? ''), 'utf8').toLowerCase();
      if (content.includes('fastapi')) stack.add('FastAPI');
      if (content.includes('flask')) stack.add('Flask');
      if (content.includes('django')) stack.add('Django');
      if (content.includes('uvicorn')) stack.add('Uvicorn');
    } catch { /* 无 requirements */ }
  }
  // 从源码兜底识别 FastAPI（没有 requirements 的场合）
  return [...stack];
}
