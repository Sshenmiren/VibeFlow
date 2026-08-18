# whatdidaido

把代码项目转换成非程序员也能看懂的可视化项目视图，并能用自然语言或在图上直接画模块来驱动 AI 修改代码。它是 Claude Code / Codex 这类 AI coding 工具的可视化搭档。

[English README](./README.en.md)

<!-- 截图/演示 GIF 占位 -->
<!-- ![演示截图](./docs/screenshot.png) -->

---

## 核心特性

**四张视图，读懂 AI 写的代码**

AI 写完一堆代码，你不知道它实现了什么。这个工具把项目自动转成四张图：用户流程、功能总览、页面流程、数据流。每个节点点开都有大白话说明、伪代码、对应的真实源码文件和行号。开发者模式另提供技术关系图（文件夹 → 文件 → 导入关系）。

**在图上画模块，驱动 AI 改代码**

纯文字 vibe coding 的问题：你要用精确的文字描述需求，描述能力差就得到错误结果，一句话塞太多逻辑 AI 容易理解偏。这个工具让你在图上直接表达：拖出一个新模块，写上它做什么，连线到已有环节，注明触发关系，点确认。AI 拿到的不只是文字，还有现有代码的具体位置，去实现它。表达方式从"写作文"变成"画流程图"。

**数据流图辅助发现业务安全问题**

数据流视图能看出数据从哪来、经过哪些处理、到哪里去。没有校验的环节、未鉴权的路径，在图上比在成千上万行代码里好找得多。

**增量同步**

chokidar 监听文件变化。你在另一个终端让 Claude Code 改代码，这边的视图自动更新，只重新分析变化的部分。

**修改全程可控**

自然语言或图上画模块都能触发修改。流程：AI 生成计划 → 展示影响范围 → 真实 diff → 自动跑测试并区分"本来就挂的"和"这次改挂的" → 一键接受或回滚。全程 Git 保护。

---

## 使用场景

**场景 A：看懂 AI 写的东西**

你用 Claude Code vibe 出一个小应用，但不确定它到底实现了什么。导入项目，打开用户流程图，点开每个节点看大白话说明，顺手能跳到对应源码行号。

**场景 B：想加功能但描述不清楚**

你想加个每日签到，但不知道怎么用一句话说清楚要改哪些地方。在用户流程图上新建一个"每日签到"模块，连线到"进入主菜单"节点，注明"进入时检查今天是否签到"，点确认，AI 带着主菜单对应的源码位置去实现。

**场景 C：怀疑项目有安全问题**

打开数据流视图，发现用户输入直接流向了数据库节点，中间没有校验环节，一眼定位问题所在。

---

## 环境要求

- Node.js >= 20
- AI 功能需要本机安装 [Claude Code CLI](https://claude.com/claude-code)（`claude` 命令可用即可，使用你现有的订阅）
- 无需数据库，无需 Docker
- 可选：OpenAI 兼容 API（仅用于解释和问答，不支持代码修改）

---

## 快速上手

```bash
git clone <仓库地址>
cd whatdidaido
npm install

# 开发模式（前端 5173，后端 5177）
npm run dev

# 生产模式
npm run build && npm start
```

打开 `http://localhost:5173`（开发）或 `http://localhost:5177`（生产），在首页输入目标项目文件夹的绝对路径即可导入。空文件夹也支持，开始写代码后视图会自动生成。

---

## MCP 接入

让 Claude Code 直接查询项目地图（找功能、查文件角色、分析影响范围等），而不是重新扫描代码：

```bash
claude mcp add whatdidaido -- npx -y tsx <本仓库路径>/server/mcp.ts
```

接入后 Claude Code 可以使用以下 6 个只读工具：`list_projects`、`get_project_summary`、`find_feature`、`get_node_source`、`get_file_role`、`get_impact`。

---

## 配置说明

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `5177` | 服务端口 |
| `HOST` | `127.0.0.1` | 绑定地址，仅本地访问 |
| `OPENAI_BASE_URL` | — | OpenAI 兼容 API 地址 |
| `OPENAI_API_KEY` | — | OpenAI 兼容模式 API Key（存服务端，不下发前端） |

默认只绑 `127.0.0.1`，分析在本机完成，不向外部发送代码。

---

## 技术实现

```
server/   Express + chokidar + web-tree-sitter (WASM) + simple-git
  parser/   tree-sitter 提取 imports / 符号 / 调用 / 路由
  resolver  ts.resolveModuleName + Python 相对导入启发式
  analyzer  全量 / 增量分析（内容 hash 判变）
  views     静态事实 → LLM 翻译 → zod 校验 → sourceRef 落地校验
  modify    计划 → AI 改码 → git diff → 测试 → accept / rollback
  mcp.ts    MCP Server（6 个只读工具）

client/   Vite + React 19 + @xyflow/react + @dagrejs/dagre
shared/   数据模型 + zod schema
```

几个设计决策：

- **静态分析零 LLM 成本**：tree-sitter (WASM 运行，无 native 编译依赖) 提取所有结构信息；模块路径解析复用 typescript 包的 `ts.resolveModuleName`。支持 TS/TSX/JS/JSX 深度分析，Python 基础分析。
- **AI 输出强校验**：zod schema 约束结构，sourceRef 落地校验（对照实际文件列表），禁止 AI 编造不存在的文件路径。
- **AI 引擎可替换**：默认用本机 `claude` CLI（headless 模式），可切换为任意 OpenAI 兼容 API，Key 存服务端不进浏览器。
- **解释缓存**：按代码内容 hash 缓存，代码没变不重复调用 LLM。惰性生成：点开节点才触发，多节点批量合进一次调用。
- **数据存目标项目 `.whatdidaido/` 目录**（JSON），通过 `.git/info/exclude` 忽略，不污染用户的 `.gitignore`。
- **本地优先**：服务默认绑 `127.0.0.1`，分析在本机完成。

---

## 已知限制

- Python 为基础级分析（import / 函数 / 类 / FastAPI 路由），跨文件调用链深度以 TS/JS 为准
- 大型项目（>1000 文件）的事实摘要会截断低重要度文件的符号细节
- OpenAI 兼容模式仅支持解释和问答，不支持代码修改，也无成本统计
- 修改前要求工作区干净（未提交的改动需先快照或暂存）
- 业务视图不随代码自动重生成，代码变化后会标"刚变化"提醒，需手动点"重新生成地图"
- 界面目前仅中文

---

## 参与贡献

欢迎提 Issue 和 PR。提 PR 前请先运行 `npm run typecheck && npm run lint && npm test`。

---

## 开源协议

MIT © whatdidaido contributors
