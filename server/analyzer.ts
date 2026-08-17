import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type { AnalysisProgress, FileFact, ProjectMeta } from '../shared/types.ts';
import { extractFacts } from './parser/extract.ts';
import { extFromPath, initParsers } from './parser/treesitter.ts';
import { ModuleResolver } from './resolver.ts';
import { detectTechStack, isAnalyzable, scanProject } from './scanner.ts';
import { ProjectStore, contentHash } from './store.ts';

export type ProgressFn = (p: AnalysisProgress) => void;

/** 全量分析：扫描→解析→解析导入→存储 */
export async function analyzeFull(store: ProjectStore, meta: ProjectMeta, onProgress?: ProgressFn): Promise<ProjectMeta> {
  await initParsers();
  const root = store.projectRoot;
  onProgress?.({ phase: 'scanning', done: 0, total: 0 });
  const scanned = scanProject(root);
  const resolver = new ModuleResolver(root);
  const files: Record<string, FileFact> = {};

  let done = 0;
  for (const s of scanned) {
    onProgress?.({ phase: 'parsing', done: ++done, total: scanned.length, currentFile: s.relPath });
    const fact = analyzeOne(root, s.relPath, resolver);
    if (fact) files[fact.path] = fact;
  }

  onProgress?.({ phase: 'graphing', done: scanned.length, total: scanned.length });
  tagFiles(files);

  store.saveFiles(files);
  const updated: ProjectMeta = {
    ...meta,
    techStack: detectTechStack(root, Object.keys(files)),
    analysisVersion: meta.analysisVersion + 1,
    analyzedAt: new Date().toISOString(),
    gitCommit: await currentCommit(root),
    fileCount: Object.keys(files).length,
    status: Object.keys(files).length === 0 ? 'empty' : 'ready',
  };
  store.saveMeta(updated);
  onProgress?.({ phase: 'done', done: scanned.length, total: scanned.length });
  return updated;
}

/** 增量分析：只重新解析变化的文件。返回真正发生变化的文件（含删除）。 */
export async function analyzeIncremental(
  store: ProjectStore, meta: ProjectMeta, changedRelPaths: string[],
): Promise<{ meta: ProjectMeta; changed: string[] }> {
  await initParsers();
  const root = store.projectRoot;
  const files = store.getFiles();
  const resolver = new ModuleResolver(root);
  const reallyChanged: string[] = [];

  for (const rel of changedRelPaths) {
    const posix = rel.split(path.sep).join('/');
    if (!isAnalyzable(root, posix)) continue;
    const abs = path.join(root, posix);
    if (!fs.existsSync(abs)) {
      if (files[posix]) {
        delete files[posix];
        reallyChanged.push(posix);
      }
      continue;
    }
    const prevHash = files[posix]?.hash;
    const fact = analyzeOne(root, posix, resolver);
    if (!fact) continue;
    if (fact.hash !== prevHash) {
      files[posix] = fact;
      reallyChanged.push(posix);
    }
  }

  if (reallyChanged.length === 0) return { meta, changed: [] };

  tagFiles(files);
  store.saveFiles(files);
  const updated: ProjectMeta = {
    ...meta,
    techStack: detectTechStack(root, Object.keys(files)),
    analysisVersion: meta.analysisVersion + 1,
    analyzedAt: new Date().toISOString(),
    gitCommit: await currentCommit(root),
    fileCount: Object.keys(files).length,
    status: Object.keys(files).length === 0 ? 'empty' : 'ready',
  };
  store.saveMeta(updated);

  // 事实变了 → 相关解释作废（factsHash 不再匹配，由 explain 层惰性重生成）
  return { meta: updated, changed: reallyChanged };
}

function analyzeOne(root: string, relPath: string, resolver: ModuleResolver): FileFact | null {
  const abs = path.join(root, relPath);
  let content: string;
  let size: number;
  try {
    content = fs.readFileSync(abs, 'utf8');
    size = Buffer.byteLength(content);
  } catch { return null; }
  const lang = extFromPath(relPath);
  const { imports, symbols } = extractFacts(relPath, lang, content);
  for (const imp of imports) {
    imp.resolved = resolver.resolve(lang, imp.specifier, relPath);
  }
  return {
    path: relPath,
    lang,
    hash: contentHash(content),
    size,
    lines: content.split('\n').length,
    imports,
    symbols,
    tags: [],
  };
}

/** 入口/页面等标签（启发式，纯静态） */
function tagFiles(files: Record<string, FileFact>) {
  for (const f of Object.values(files)) {
    const tags: string[] = [];
    const base = path.posix.basename(f.path).toLowerCase();
    if (/^(main|index|app)\.(tsx?|jsx?|py)$/.test(base)) tags.push('entry');
    if (/\/(pages|views|screens)\//.test('/' + f.path) || /page\.(tsx?|jsx?)$/.test(base)) tags.push('page');
    if (f.symbols.some(s => s.kind === 'route')) tags.push('api');
    if (f.symbols.some(s => s.kind === 'component')) tags.push('ui');
    if (/config|settings|\.json$/.test(base)) tags.push('config');
    if (/store|state|model/.test(base)) tags.push('data');
    f.tags = tags;
  }
}

async function currentCommit(root: string): Promise<string | null> {
  try {
    const git = simpleGit(root);
    if (!(await git.checkIsRepo())) return null;
    return (await git.revparse(['HEAD'])).trim();
  } catch { return null; }
}
