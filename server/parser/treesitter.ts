import { Parser, Language } from 'web-tree-sitter';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Lang } from '../../shared/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const WASM_DIR = path.resolve(here, '../../node_modules/tree-sitter-wasms/out');

const LANG_WASM: Record<string, string> = {
  ts: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  js: 'tree-sitter-javascript.wasm',
  jsx: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
};

let initialized = false;
const languages = new Map<string, Language>();
let parser: Parser | null = null;

export async function initParsers(): Promise<void> {
  if (initialized) return;
  await Parser.init();
  for (const [lang, wasm] of Object.entries(LANG_WASM)) {
    languages.set(lang, await Language.load(path.join(WASM_DIR, wasm)));
  }
  parser = new Parser();
  initialized = true;
}

/** 解析单个文件，返回语法树；不支持的语言返回 null。调用方负责 tree.delete() */
export function parseFile(lang: Lang, source: string) {
  if (!parser) throw new Error('parsers not initialized');
  const language = languages.get(lang);
  if (!language) return null;
  parser.setLanguage(language);
  return parser.parse(source);
}

export function extFromPath(p: string): Lang {
  const ext = path.extname(p).toLowerCase();
  switch (ext) {
    case '.ts': return p.endsWith('.d.ts') ? 'other' : 'ts';
    case '.tsx': return 'tsx';
    case '.js': case '.mjs': case '.cjs': return 'js';
    case '.jsx': return 'jsx';
    case '.py': return 'python';
    case '.json': return 'json';
    default: return 'other';
  }
}
