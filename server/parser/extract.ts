import type { Node as TSNode } from 'web-tree-sitter';
import type { FileFact, ImportFact, Lang, SymbolFact, SymbolKind } from '../../shared/types.ts';
import { parseFile } from './treesitter.ts';

/** 从源码提取事实。解析失败/不支持的语言返回空事实。 */
export function extractFacts(relPath: string, lang: Lang, source: string): Pick<FileFact, 'imports' | 'symbols'> {
  if (lang === 'python') return extractPython(source);
  if (lang === 'ts' || lang === 'tsx' || lang === 'js' || lang === 'jsx') return extractTsJs(lang, source);
  return { imports: [], symbols: [] };
}

// ---------------- TS / JS ----------------

function extractTsJs(lang: Lang, source: string): Pick<FileFact, 'imports' | 'symbols'> {
  const tree = parseFile(lang, source);
  if (!tree) return { imports: [], symbols: [] };
  const imports: ImportFact[] = [];
  const symbols: SymbolFact[] = [];

  const root = tree.rootNode;
  for (const child of root.namedChildren) {
    if (!child) continue;
    collectTopLevel(child, false);
  }

  function collectTopLevel(node: TSNode, exported: boolean) {
    switch (node.type) {
      case 'import_statement': {
        const imp = readImport(node);
        if (imp) imports.push(imp);
        break;
      }
      case 'export_statement': {
        // export { x } from './y' 也是依赖
        const src = node.childForFieldName('source');
        if (src) {
          imports.push({ specifier: unquote(src.text), resolved: null, names: ['*'] });
        }
        const decl = node.namedChildren.find(c => c && c.type !== 'string' && c.type !== 'export_clause');
        if (decl) collectTopLevel(decl, true);
        break;
      }
      case 'function_declaration': {
        const sym = readFunction(node, exported);
        if (sym) symbols.push(sym);
        break;
      }
      case 'class_declaration': {
        const name = node.childForFieldName('name')?.text ?? '(匿名类)';
        symbols.push({
          name,
          kind: classifyName(name, node, 'class'),
          exported,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          calls: collectCalls(node),
          signature: `class ${name}`,
        });
        break;
      }
      case 'lexical_declaration':
      case 'variable_declaration': {
        for (const declarator of node.namedChildren) {
          if (!declarator || declarator.type !== 'variable_declarator') continue;
          const name = declarator.childForFieldName('name')?.text;
          const value = declarator.childForFieldName('value');
          if (!name || !value) continue;
          if (value.type === 'arrow_function' || value.type === 'function_expression') {
            symbols.push({
              name,
              kind: classifyName(name, value, 'function'),
              exported,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              calls: collectCalls(value),
              signature: `${name}${paramsText(value)}`,
            });
          } else if (exported) {
            symbols.push({
              name, kind: 'variable', exported,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              calls: collectCalls(value),
            });
          }
        }
        break;
      }
      default:
        // 顶层 Express 风格路由：app.get('/x', handler)
        if (node.type === 'expression_statement') {
          const route = readExpressRoute(node);
          if (route) symbols.push(route);
        }
        break;
    }
  }

  function readImport(node: TSNode): ImportFact | null {
    const src = node.childForFieldName('source');
    if (!src) return null;
    const names: string[] = [];
    const clause = node.namedChildren.find(c => c && c.type === 'import_clause');
    if (clause) {
      for (const c of clause.namedChildren) {
        if (!c) continue;
        if (c.type === 'identifier') names.push('default');
        else if (c.type === 'namespace_import') names.push('*');
        else if (c.type === 'named_imports') {
          for (const spec of c.namedChildren) {
            if (spec?.type === 'import_specifier') {
              const n = spec.childForFieldName('name')?.text;
              if (n) names.push(n);
            }
          }
        }
      }
    }
    return { specifier: unquote(src.text), resolved: null, names };
  }

  function readFunction(node: TSNode, exported: boolean): SymbolFact | null {
    const name = node.childForFieldName('name')?.text ?? (exported ? 'default' : null);
    if (!name) return null;
    return {
      name,
      kind: classifyName(name, node, 'function'),
      exported,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      calls: collectCalls(node),
      signature: `${name}${paramsText(node)}`,
    };
  }

  function readExpressRoute(stmt: TSNode): SymbolFact | null {
    const call = stmt.namedChildren[0];
    if (!call || call.type !== 'call_expression') return null;
    const fn = call.childForFieldName('function');
    if (!fn || fn.type !== 'member_expression') return null;
    const method = fn.childForFieldName('property')?.text ?? '';
    if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) return null;
    const args = call.childForFieldName('arguments');
    const first = args?.namedChildren[0];
    if (!first || first.type !== 'string') return null;
    const routePath = unquote(first.text);
    return {
      name: `${method.toUpperCase()} ${routePath}`,
      kind: 'route',
      exported: false,
      startLine: stmt.startPosition.row + 1,
      endLine: stmt.endPosition.row + 1,
      calls: collectCalls(call),
      route: `${method.toUpperCase()} ${routePath}`,
    };
  }

  function classifyName(name: string, body: TSNode, fallback: SymbolKind): SymbolKind {
    if (/^use[A-Z]/.test(name)) return 'hook';
    if (/^[A-Z]/.test(name) && containsJsx(body)) return 'component';
    return fallback;
  }

  const result = { imports, symbols };
  tree.delete();
  return result;
}

function containsJsx(node: TSNode): boolean {
  if (node.type.startsWith('jsx_')) return true;
  // 限深遍历，避免大文件全树扫描
  const cursor = node.walk();
  let found = false;
  let visited = 0;
  const visit = (): void => {
    if (found || visited++ > 4000) return;
    if (cursor.nodeType.startsWith('jsx_')) { found = true; return; }
    if (cursor.gotoFirstChild()) {
      do { visit(); if (found) break; } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  };
  visit();
  cursor.delete();
  return found;
}

/** 收集节点体内所有调用的函数名（obj.method() 记 method），去重、封顶 */
function collectCalls(node: TSNode): string[] {
  const calls = new Set<string>();
  const cursor = node.walk();
  let visited = 0;
  const visit = (): void => {
    if (visited++ > 20000 || calls.size >= 60) return;
    const t = cursor.nodeType;
    if (t === 'call_expression' || t === 'call') {
      const n = cursor.currentNode;
      const fn = n.childForFieldName('function');
      if (fn) {
        if (fn.type === 'identifier') calls.add(fn.text);
        else if (fn.type === 'member_expression' || fn.type === 'attribute') {
          const prop = fn.childForFieldName('property') ?? fn.childForFieldName('attribute');
          if (prop) calls.add(prop.text);
        }
      }
    }
    if (cursor.gotoFirstChild()) {
      do { visit(); } while (cursor.gotoNextSibling());
      cursor.gotoParent();
    }
  };
  visit();
  cursor.delete();
  return [...calls];
}

function paramsText(fnNode: TSNode): string {
  const params = fnNode.childForFieldName('parameters');
  const text = params?.text ?? '()';
  return text.length > 80 ? text.slice(0, 77) + '…)' : text;
}

function unquote(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, '');
}

// ---------------- Python ----------------

function extractPython(source: string): Pick<FileFact, 'imports' | 'symbols'> {
  const tree = parseFile('python', source);
  if (!tree) return { imports: [], symbols: [] };
  const imports: ImportFact[] = [];
  const symbols: SymbolFact[] = [];

  for (const child of tree.rootNode.namedChildren) {
    if (!child) continue;
    switch (child.type) {
      case 'import_statement': {
        // import a.b, c
        for (const name of child.namedChildren) {
          if (name?.type === 'dotted_name') imports.push({ specifier: name.text, resolved: null, names: ['*'] });
          else if (name?.type === 'aliased_import') {
            const dotted = name.namedChildren[0];
            if (dotted) imports.push({ specifier: dotted.text, resolved: null, names: ['*'] });
          }
        }
        break;
      }
      case 'import_from_statement': {
        const moduleNode = child.childForFieldName('module_name');
        const specifier = moduleNode?.text ?? '';
        const names: string[] = [];
        for (const n of child.namedChildren) {
          if (n === moduleNode || !n) continue;
          if (n.type === 'dotted_name' || n.type === 'identifier') names.push(n.text);
          else if (n.type === 'aliased_import') {
            const orig = n.namedChildren[0];
            if (orig) names.push(orig.text);
          } else if (n.type === 'wildcard_import') names.push('*');
        }
        if (specifier) imports.push({ specifier, resolved: null, names });
        break;
      }
      case 'function_definition':
        symbols.push(readPyFunction(child, null));
        break;
      case 'decorated_definition': {
        const def = child.childForFieldName('definition');
        if (def?.type === 'function_definition') {
          symbols.push(readPyFunction(def, child));
        } else if (def?.type === 'class_definition') {
          symbols.push(readPyClass(def));
        }
        break;
      }
      case 'class_definition':
        symbols.push(readPyClass(child));
        break;
    }
  }

  function readPyFunction(def: TSNode, decorated: TSNode | null): SymbolFact {
    const name = def.childForFieldName('name')?.text ?? '(匿名)';
    let kind: SymbolKind = 'function';
    let route: string | undefined;
    if (decorated) {
      // @app.get("/path") / @router.post(...)
      for (const dec of decorated.namedChildren) {
        if (dec?.type !== 'decorator') continue;
        const m = dec.text.match(/@\w+\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/);
        if (m) {
          kind = 'route';
          route = `${m[1].toUpperCase()} ${m[2]}`;
        }
      }
    }
    const params = def.childForFieldName('parameters')?.text ?? '()';
    const outer = decorated ?? def;
    return {
      name, kind, exported: true,
      startLine: outer.startPosition.row + 1,
      endLine: outer.endPosition.row + 1,
      calls: collectCalls(def),
      route,
      signature: `def ${name}${params.length > 80 ? params.slice(0, 77) + '…)' : params}`,
    };
  }

  function readPyClass(def: TSNode): SymbolFact {
    const name = def.childForFieldName('name')?.text ?? '(匿名类)';
    return {
      name, kind: 'class', exported: true,
      startLine: def.startPosition.row + 1,
      endLine: def.endPosition.row + 1,
      calls: collectCalls(def),
      signature: `class ${name}`,
    };
  }

  const result = { imports, symbols };
  tree.delete();
  return result;
}
