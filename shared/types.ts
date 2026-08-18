// ============ 核心数据模型 ============
// 所有分析结果的持久化结构。存于目标项目 <root>/.whatdidaido/ 下。

/** 源码引用：任何节点都必须能追溯到真实文件 */
export interface SourceRef {
  file: string; // 相对项目根的 posix 路径
  symbol?: string; // 函数/类/组件名
  startLine?: number;
  endLine?: number;
}

// ---------- 静态分析事实层（零 LLM，纯 tree-sitter） ----------

export type Lang = 'ts' | 'tsx' | 'js' | 'jsx' | 'python' | 'json' | 'other';

export interface ImportFact {
  /** 原始模块说明符，如 './api/client' 或 'react' */
  specifier: string;
  /** 解析后的项目内相对路径；外部包则为 null */
  resolved: string | null;
  /** 导入的符号名（default 记作 'default'，namespace 记作 '*'） */
  names: string[];
}

export type SymbolKind =
  | 'function'
  | 'class'
  | 'component' // 返回 JSX 的函数/类
  | 'hook' // use 开头的函数
  | 'route' // FastAPI/Express 路由处理器
  | 'variable'
  | 'method';

export interface SymbolFact {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  startLine: number;
  endLine: number;
  /** 该符号体内的调用点（函数名，含 obj.method 形式记作 method） */
  calls: string[];
  /** 路由符号附加信息，如 'GET /api/game/start' */
  route?: string;
  /** 一行签名，供 LLM 与详情面板使用 */
  signature?: string;
}

export interface FileFact {
  path: string; // 相对项目根 posix 路径
  lang: Lang;
  hash: string; // 内容 hash，增量分析的依据
  size: number;
  lines: number;
  imports: ImportFact[];
  symbols: SymbolFact[];
  /** 分析器附注：如 'entry'（入口文件）、'page'、'config' */
  tags: string[];
}

// ---------- 技术关系图（文件夹→文件→导入） ----------

export interface TechNode {
  id: string; // 'folder:src/components' | 'file:src/App.tsx'
  type: 'folder' | 'file';
  label: string;
  path: string;
  parent?: string; // 文件夹包含关系
  lang?: Lang;
  symbolCount?: number;
  tags?: string[];
}

export interface TechEdge {
  id: string;
  source: string; // TechNode id
  target: string;
  kind: 'import';
  /** 导入了哪些符号 */
  names?: string[];
}

export interface TechGraph {
  nodes: TechNode[];
  edges: TechEdge[];
}

// ---------- 业务视图层（LLM 从事实翻译，经 zod 校验） ----------

export type ViewKind = 'journey' | 'features' | 'pageflow' | 'dataflow';

export interface BizNode {
  id: string;
  title: string; // 小白能懂的短标题，如 "开始新游戏"
  summary: string; // 一句话说明
  /** 必须指向真实文件，服务器校验 */
  sourceRefs: SourceRef[];
  /** 视图内分组，如旅程的阶段名 */
  group?: string;
  icon?: string; // emoji
}

export interface BizEdge {
  id: string;
  source: string;
  target: string;
  label?: string; // 如 "点击开始按钮"
}

export interface BizView {
  kind: ViewKind;
  title: string;
  nodes: BizNode[];
  edges: BizEdge[];
}

export interface BusinessViews {
  views: BizView[];
  /** 生成时的分析版本，用于判定过期 */
  analysisVersion: number;
  generatedAt: string;
  gitCommit: string | null;
  /** 项目一句话总述（自然语言，"这个项目到底做了什么"） */
  projectSummary: string;
}

// ---------- 小白解释层 ----------

export interface NodeExplanation {
  nodeId: string;
  /** 这个环节是干什么的 */
  what: string;
  /** 用户什么时候会遇到它 */
  when: string;
  /** 它接收什么 */
  inputs: string;
  /** 它会产生什么结果 */
  outputs: string;
  /** 出错时用户会看到什么 */
  onError: string;
  /** 它依赖哪些其他环节（自然语言） */
  dependsOn: string;
  /** 修改它可能影响哪里 */
  impact: string;
  /** ≤12 行自然语言伪代码 */
  pseudocode: string[];
  /** 生成时底层事实的 hash —— 事实没变就不重新生成 */
  factsHash: string;
  generatedAt: string;
}

// ---------- AI 修改闭环 ----------

export type ChangeSetStatus =
  | 'planning' // 生成计划中
  | 'planned' // 计划已出，等确认
  | 'executing' // claude 修改中
  | 'diffed' // diff 已出，测试中或等待验收
  | 'testing'
  | 'tested' // 测试跑完（可能有失败）
  | 'accepted'
  | 'rolledback'
  | 'failed';

export interface TestRun {
  command: string;
  ok: boolean;
  exitCode: number;
  outputTail: string; // 最后 ~40 行
  durationMs: number;
}

export interface ChangeSet {
  id: string;
  nodeId: string;
  nodeTitle: string;
  instruction: string; // 用户的自然语言
  status: ChangeSetStatus;
  plan: {
    files: string[]; // 预计修改的文件
    affectedNodeIds: string[]; // 受影响业务节点
    note: string;
  } | null;
  diff: string | null; // unified diff
  changedFiles: string[];
  tests: TestRun[];
  aiCostUsd: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------- 时间线 ----------

export type TimelineEventKind =
  | 'import' // 项目导入
  | 'analysis' // 全量/增量分析
  | 'files-changed' // 外部文件变化（含 Claude Code 修改）
  | 'views-generated'
  | 'modify' // AI 修改生命周期
  | 'note';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  at: string;
  title: string;
  detail?: string;
  files?: string[];
  changeSetId?: string;
  costUsd?: number;
}

// ---------- 构建蓝图（用户自由画布：模块和连线的含义都由用户自己写） ----------

export interface BlueprintBlock {
  id: string;
  title: string; // 用户写：这个模块叫什么
  desc: string; // 用户写：这个模块做什么
  x: number;
  y: number;
  /** 画在哪个视图上（journey/features/pageflow/dataflow） */
  view: string;
}

export interface BlueprintConnection {
  id: string;
  /** 可以是草稿模块 id，也可以是视图里真实节点的 id（构想接入现有环节） */
  source: string;
  target: string;
  label: string; // 用户写：这条线传什么/触发什么
  view: string;
}

export interface Blueprint {
  blocks: BlueprintBlock[];
  connections: BlueprintConnection[];
  updatedAt: string;
}

/** 用户手动拖动后的节点位置（按视图分开存） */
export type ViewLayouts = Record<string, Record<string, { x: number; y: number }>>;

// ---------- 项目与设置 ----------

export interface ProjectMeta {
  id: string;
  path: string; // 绝对路径
  name: string;
  techStack: string[]; // 如 ['React', 'Vite', 'FastAPI', 'Python']
  importedAt: string;
  analysisVersion: number; // 每次(增量)分析 +1
  analyzedAt: string | null;
  gitCommit: string | null;
  fileCount: number;
  /** 分析中/空闲 */
  status: 'analyzing' | 'ready' | 'error' | 'empty';
  error?: string;
}

export interface AiSettings {
  provider: 'claude-cli' | 'openai-compat';
  /** claude-cli 用 --model 传递；openai-compat 为 model 名 */
  model: string;
  /** openai-compat 专用（key 存服务端 .env，永不下发前端） */
  openaiBaseUrl?: string;
  /** 累计成本 */
  totalCostUsd: number;
}

// ---------- API 辅助 ----------

export interface AnalysisProgress {
  phase: 'scanning' | 'parsing' | 'graphing' | 'done';
  done: number;
  total: number;
  currentFile?: string;
}

/** SSE 事件流的统一封包 */
export type ServerEvent =
  | { type: 'analysis:progress'; projectId: string; progress: AnalysisProgress }
  | { type: 'analysis:done'; projectId: string; version: number }
  | { type: 'files:changed'; projectId: string; files: string[]; staleNodeIds: string[] }
  | { type: 'timeline'; projectId: string; event: TimelineEvent }
  | { type: 'changeset'; projectId: string; changeSet: ChangeSet }
  | { type: 'views:stale'; projectId: string; staleNodeIds: string[] };

export interface ImpactResult {
  nodeId: string;
  /** 直接相关文件 */
  files: string[];
  /** 依赖这些文件的下游文件（改了会波及） */
  dependents: string[];
  /** 共享文件的其他业务节点 */
  relatedBizNodes: { id: string; title: string; viewKind: ViewKind }[];
}
