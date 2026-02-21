# Forge

**Your AI development foundry** — a desktop-native, workspace-centric AI agent workspace.

Forge is a local-first Electron app where the unit of organization is your **project folder**, not a chat thread. Describe what you need, and the system automatically routes to the right AI CLI, runs agents in parallel, and keeps them going until the job is done.

## Key Features

- **Workspace-first** — Open a project folder; everything flows from that. Each workspace gets isolated memory, agent sessions, and skills.
- **Intent-based routing** — Type a task in the SpawnBar and the Task Router picks the right CLI (Claude, Gemini, Codex, Copilot, Qwen, LLM) automatically.
- **Continuation Engine** — Agents don't quit mid-task. The built-in loop watches for idle prompts and auto-continues until the work is done or a max iteration limit is reached.
- **Agent Graph** — Live SVG visualization showing running agents, data flow, and token usage at a glance.
- **Per-workspace memory** — BM25-ranked search over SQLite FTS5, scoped to each project.
- **Skills system** — Drop `SKILL.md` files into your workspace to extend agent behavior with zero config.
- **Multi-tab agent terminals** — One xterm.js terminal per agent, with real PTY sessions.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Electron 35 |
| Frontend | React 18 + Vite 6 |
| Styling | Tailwind CSS 3.4 |
| Terminal | xterm.js 5 + @lydell/node-pty |
| Database | better-sqlite3 (WAL mode, FTS5) |
| Language | TypeScript (strict) |

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- At least one AI CLI installed and on your PATH (e.g., `claude`, `gemini`, `codex`)

### Install & Run

```bash
npm install
npm run dev
```

### Build

```bash
npm run build
```

Platform-specific builds:

```bash
npm run dist:win     # Windows portable
npm run dist:mac     # macOS dmg + zip
npm run dist:linux   # Linux AppImage
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Electron Main Process                          │
│  Workspace Manager · Memory (BM25) · Router     │
│  PTY Manager · Continuation Engine              │
│  SQLite (WAL) — forge.db                        │
└──────────────────┬──────────────────────────────┘
                   │ contextBridge IPC
┌──────────────────▼──────────────────────────────┐
│  React Renderer                                 │
│  TitleBar · Sidebar · Terminal · SpawnBar        │
│  AgentGraph · WorkspaceContext                   │
└──────────────────┬──────────────────────────────┘
                   │ Native CLI (shell)
┌──────────────────▼──────────────────────────────┐
│  AI CLIs (via PATH)                             │
│  claude · gemini · codex · copilot · qwen · llm │
└─────────────────────────────────────────────────┘
```

## Project Structure

```
electron/          Main process (IPC handlers, PTY, DB, router, continuation)
src/               React renderer (components, contexts)
scripts/           Build helpers (preflight native module check)
```

## License

[MIT](LICENSE)
