# 📜 whatdidaido · 项目舆图

把任何软件项目变成一张**普通人能看懂的活地图**。为 vibe coding 而生：Claude Code / Codex 在隔壁改代码，这里的地图实时跟着变。

- 🗺️ 四种理解视图：**用户旅程 / 功能地图 / 页面流程 / 数据流**（开发者模式再加**技术关系图**：文件夹→文件→导入关系）
- 🔍 点击任何环节：通俗解释、伪代码、输入输出、出错表现、影响范围、真实源码定位
- 💬 「问问它」：只针对这个环节的 AI 问答
- ✏️ 「修改它」：自然语言 → AI 定位代码 → 展示计划与影响 → 真实改动 diff → 自动跑测试 → 一键接受或回滚（全程 Git 保护）
- 🔄 增量同步：**无论谁改了文件**（你、编辑器、另一个终端里的 Claude Code），地图只重新分析变化部分
- 📔 底部航行日志：AI 刚刚改了什么、花了多少钱，一目了然

## 运行

```bash
npm install
npm run dev        # 开发：server(5177) + client(5173)，打开 http://localhost:5173
# 或
npm run build && npm start   # 生产：打开 http://localhost:5177
```

要求：Node ≥ 20；**AI 功能需要本机安装 [Claude Code CLI](https://claude.com/claude-code)**（`claude` 命令可用即可，走你现有的订阅/配置）。

首页输入项目文件夹的完整路径（空文件夹也行——开始写代码后地图会自己生长）。

## 与 Claude Code 协同

无需任何配置：本工具用文件监听器感知一切变化。你在另一个终端让 Claude Code 干活，这边的地图和时间线会自动增量更新。可选地，在目标项目的 `CLAUDE.md` 里加一句，让 Claude Code 知道地图的存在：

```markdown
本项目由 whatdidaido 维护实时项目地图（.whatdidaido/ 目录，勿手动编辑、勿提交）。
```

## AI 引擎与成本控制

| 机制 | 说明 |
|---|---|
| 默认引擎 | 本机 `claude` CLI（headless），解释/问答/修改都走它；`--setting-sources project` 跳过全局配置 |
| 可替换 | 设置里可切 OpenAI 兼容 API（仅解释/问答；Key 放服务端环境变量 `OPENAI_API_KEY`，绝不进浏览器） |
| 静态分析 | **零 LLM**：tree-sitter 解析文件/符号/调用/导入，全部本地完成 |
| 解释缓存 | 按底层代码内容 hash 缓存；代码没变，永不重复调用 |
| 惰性生成 | 点开节点才生成解释；批量接口把多节点合进一次调用 |
| 防抖 | `npm install`/`git checkout` 引发的文件风暴合并为一次增量分析，不触发 LLM |
| 成本可见 | 每次调用的花费记录在时间线和顶栏累计 |

## 架构（单体，零 native 编译）

```
server/  Express + chokidar + web-tree-sitter(WASM) + simple-git
  parser/    tree-sitter 提取 imports/符号/调用/路由（TS/TSX/JS/JSX 深度 + Python 基础）
  resolver   ts.resolveModuleName（复用 typescript 包）+ Python 相对导入启发式
  analyzer   全量/增量分析（内容 hash 判变）
  views      静态事实 → LLM 翻译 → zod 校验 → sourceRef 落地校验（禁止编造文件）
  modify     计划(纯静态) → claude 改码 → git diff → 测试 → accept/rollback
client/  Vite + React + @xyflow/react + @dagrejs/dagre（舆图风格 UI）
shared/  数据模型 + zod schema
```

分析结果存在目标项目 `.whatdidaido/`（JSON，含分析版本与 git commit），刷新页面不丢；通过 `.git/info/exclude` 忽略，不污染你的 `.gitignore`。

## 已复用的开源组件

@xyflow/react (MIT) · @dagrejs/dagre (MIT) · web-tree-sitter + tree-sitter-wasms (MIT) · typescript (Apache-2.0) · simple-git (MIT) · chokidar (MIT) · zod (MIT) · jsonrepair (ISC) · express (MIT)。
设计借鉴：CodeBoarding（静态事实→LLM 翻译、增量指纹）、GitNexus（多阶段索引，*许可证为 PolyForm NC，未复用代码*）。

## 已知限制

- Python 为基础级分析（import/函数/类/FastAPI 路由）；跨文件调用链深度以 TS/JS 为准
- 修改前要求工作区干净（一键快照即可），回滚 = `git reset --hard`+`clean`
- 测试失败不区分「本来就挂」和「这次改挂的」——会如实展示，由你决定接受或回滚
- 业务视图不会随代码自动重生成（会标「刚变化」提醒），点「重新生成地图」手动刷新
- 大型项目（>1000 文件）的事实摘要会截断低重要度文件的符号细节
