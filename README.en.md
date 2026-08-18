# whatdidaido

Converts a code project into visual diagrams that non-programmers can understand, and lets you drive AI code changes through natural language or by drawing modules directly on the diagram. Built as a visual companion for AI coding tools like Claude Code and Codex.

[中文 README](./README.md)

<!-- Screenshot / demo GIF placeholder -->
<!-- ![Screenshot](./docs/screenshot.png) -->

---

## Core Features

**Four views to understand what AI actually wrote**

After an AI session produces a pile of code, it is often unclear what was built. This tool automatically generates four diagrams from the project: user flow, feature overview, page flow, and data flow. Each node shows a plain-language description, pseudocode, and the exact source file with line numbers. A developer mode adds a technical relationship graph (folders → files → import relationships).

**Draw modules on the diagram to drive AI code changes**

Pure text vibe coding has a fundamental problem: you must describe what you want in precise words. Imprecise descriptions produce wrong results, and cramming too much logic into one prompt causes misinterpretation. This tool lets you express intent visually: drag out a new module, write what it does, connect it to existing nodes, annotate the trigger relationship, then confirm. The AI receives not just your description but the concrete source locations of the connected nodes, and goes to implement it. The task shifts from writing an essay to drawing a flowchart.

**Data flow view for spotting business-logic security issues**

The data flow diagram makes it visible where data originates, what processing it goes through, and where it ends up. Missing validation steps and unauthenticated paths are much easier to spot in a diagram than in thousands of lines of source code.

**Incremental sync**

chokidar watches the filesystem. When Claude Code modifies files in another terminal, the views here update automatically, re-analyzing only the changed parts.

**Controlled, reversible changes**

Both natural language and diagram-drawn modules can trigger code modifications. The flow is: AI generates a plan → displays impact scope → shows real diff → runs tests and distinguishes pre-existing failures from newly introduced ones → one-click accept or rollback. Full Git protection throughout.

---

## Example Use Cases

**Case A: Understanding what the AI built**

You vibe-coded a small app with Claude Code and are not sure what it actually implements. Import the project, open the user flow diagram, click each node for a plain-language description, and jump to the corresponding source line if needed.

**Case B: Adding a feature when you cannot describe it cleanly**

You want to add a daily check-in but cannot easily express in one sentence which files need to change. Create a "Daily Check-in" module on the user flow diagram, connect it to the "Enter Main Menu" node, annotate "check on entry whether the user has checked in today", and confirm. The AI receives the source location of the main menu node and implements accordingly.

**Case C: Suspecting a security problem**

Open the data flow view. You see user input flowing directly to the database node with no validation node in between. The problem is located immediately.

---

## Requirements

- Node.js >= 20
- [Claude Code CLI](https://claude.com/claude-code) installed locally (`claude` command available, uses your existing subscription) for AI features
- No database required, no Docker required
- Optional: any OpenAI-compatible API (for explanations and Q&A only; code modification not supported in this mode)

---

## Quick Start

```bash
git clone <repository-url>
cd whatdidaido
npm install

# Development (frontend on 5173, backend on 5177)
npm run dev

# Production
npm run build && npm start
```

Open `http://localhost:5173` (development) or `http://localhost:5177` (production). On the home page, enter the absolute path to the target project folder. Empty folders are supported — views generate automatically as code is added.

---

## MCP Integration

Let Claude Code query the project map directly (find features, look up file roles, analyze impact) without re-scanning the codebase:

```bash
claude mcp add whatdidaido -- npx -y tsx <path-to-this-repo>/server/mcp.ts
```

Once connected, Claude Code has access to 6 read-only tools: `list_projects`, `get_project_summary`, `find_feature`, `get_node_source`, `get_file_role`, `get_impact`.

---

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `PORT` | `5177` | Server port |
| `HOST` | `127.0.0.1` | Bind address; local access only by default |
| `OPENAI_BASE_URL` | — | OpenAI-compatible API endpoint |
| `OPENAI_API_KEY` | — | API key for OpenAI-compatible mode (stored server-side, never sent to the browser) |

The server binds to `127.0.0.1` by default. All analysis runs locally; no source code is sent to external services.

---

## Technical Overview

```
server/   Express + chokidar + web-tree-sitter (WASM) + simple-git
  parser/   tree-sitter extracts imports / symbols / calls / routes
  resolver  ts.resolveModuleName + Python relative-import heuristics
  analyzer  full and incremental analysis (content-hash change detection)
  views     static facts → LLM translation → zod validation → sourceRef verification
  modify    plan → AI code change → git diff → tests → accept / rollback
  mcp.ts    MCP Server (6 read-only tools)

client/   Vite + React 19 + @xyflow/react + @dagrejs/dagre
shared/   data models + zod schemas
```

Design decisions:

- **Static analysis at zero LLM cost**: tree-sitter runs as WASM with no native compilation dependency, extracting all structural information locally. Module resolution reuses the TypeScript package's `ts.resolveModuleName`. Deep analysis for TS/TSX/JS/JSX; basic analysis for Python.
- **Strict AI output validation**: zod schemas enforce structure; sourceRef verification cross-checks against actual file lists, preventing the AI from fabricating non-existent file paths.
- **Replaceable AI engine**: defaults to the local `claude` CLI in headless mode; can be switched to any OpenAI-compatible API. API keys are stored server-side and never sent to the browser.
- **Explanation caching**: cached by source content hash; LLM is not called again if the code has not changed. Lazy generation: explanations are triggered only when a node is opened; multiple nodes are batched into a single call.
- **Data stored in the target project's `.whatdidaido/` directory** (JSON). Excluded via `.git/info/exclude` so the user's `.gitignore` is not modified.
- **Local-first**: server binds to `127.0.0.1` by default; analysis stays on the local machine.

---

## Known Limitations

- Python analysis is basic (imports, functions, classes, FastAPI routes); cross-file call-chain depth is at TS/JS level only
- Large projects (>1000 files) have symbol detail truncated for low-priority files in the fact summary
- OpenAI-compatible mode supports explanations and Q&A only; code modification and cost tracking are not available
- Code modification requires a clean working tree (uncommitted changes must be stashed or committed first)
- Business views do not auto-regenerate when code changes; changed nodes are marked "recently changed" and require a manual "Regenerate Map"
- The UI is currently Chinese-only

---

## Contributing

Issues and PRs are welcome. Before submitting a PR, run `npm run typecheck && npm run lint && npm test`.

---

## License

MIT © whatdidaido contributors
