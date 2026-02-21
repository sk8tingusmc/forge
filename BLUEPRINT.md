# FORGE — BLUEPRINT v1.0

> **"Your AI development foundry"**
> A local-first, workspace-centric AI agent workspace that synthesizes the best ideas from
> OpenClaw, NanoClaw, oh-my-opencode, pynchy, and ai-cli-switcher into something genuinely new.

---

## PART I: VISION

### The Problem

Every existing AI dev tool picks one of two broken paradigms:

| Tool | Paradigm | Failure |
|------|----------|---------|
| claw-fusion-desktop / ai-cli-switcher | Terminal multiplexer — manually switch CLIs | You decide which AI to use, not the system |
| OpenClaw | Multi-channel gateway — routes WhatsApp/Telegram to agents | Built for chat groups, not code projects |
| NanoClaw | Single-CLI personal assistant (WhatsApp only) | No desktop integration, no multi-agent |
| oh-my-opencode | OpenCode plugin — orchestrates agents inside one tool | Plugin only, no standalone app, no persistence |
| pynchy | Container-isolated group orchestration (Python, messaging-first) | No native desktop UI, no Windows support |

**What's missing:** A *desktop-native* AI workspace where:
- The unit of organization is a **project** (not a chat group, not a PTY session)
- Agent selection is **automatic** based on what you're trying to do (not manual)
- **Multiple specialized agents** run in parallel and their work is coordinated
- **Persistent memory** per project survives sessions and is searchable
- **Everything keeps running** until the task is actually done (Ralph Loop concept)
- The whole thing is **visible** — you can see agents, their state, and data flow

### Core Philosophy

1. **Workspace-first.** Open a project folder. Everything else flows from that.
2. **Route by intent, not by CLI brand.** Describe what you need; the system picks the right tool.
3. **Agents don't quit.** Continuation engine ensures tasks complete without babysitting.
4. **Persistent memory beats ephemeral context.** Every project accumulates knowledge over time.
5. **Visible orchestration.** The Agent Graph makes the invisible (parallel agent work) visible.
6. **Skills over features.** Extend via SKILL.md files, not code changes.

---

## PART II: WHAT FORGE BORROWS FROM EACH SOURCE

### From OpenClaw
- Multi-agent routing concept (route by type, not manually)
- Channel Dock abstraction (CLI Dock — per-CLI capability declarations)
- Plugin architecture pattern
- Session persistence model

### From NanoClaw
- Skills system (SKILL.md files, three-way git merge on apply)
- File-based IPC with sentinel protocol for container agents (future)
- Per-group (per-workspace) CLAUDE.md memory
- Mount allowlist for container security
- "Small enough to understand" codebase philosophy

### From oh-my-opencode
- **Ralph Loop** → Continuation Engine (auto-continue mid-task agents)
- **Todo Continuation Enforcer** → built into SpawnBar + continuation state
- **Hashline Edit** → future agent tool (planned in Phase 3)
- **IntentGate** → Task Router (classify intent before routing to CLI)
- **Skill-embedded MCPs** → SKILL.md MCP declarations (Phase 2)
- **Hierarchical AGENTS.md** → `workspace:getAgentsMd()` loads from workspace root
- **Background agents + notification** → continuation events + OS notifications

### From pynchy
- **BM25 memory search** (SQLite FTS5 with BM25 ranking) — implemented in `db.ts`
- **Per-workspace isolation** (each workspace = isolated namespace in DB)
- **Git worktree model** → planned: per-agent git branch isolation (Phase 3)
- **LiteLLM gateway concept** → planned: local proxy for cost tracking (Phase 4)
- **Plugin types** → WorkspaceAPI, MemoryAPI, AgentAPI pattern in preload.ts
- **"God group"** → admin workspace with full system access

### From ai-cli-switcher / claw-fusion-desktop
- Electron 35 + React 18 + TypeScript + Vite 6 stack (battle-tested)
- xterm.js 5 + node-pty for real PTY sessions
- better-sqlite3 WAL mode for persistence
- GitHub dark theme (hex color tokens, not Tailwind gray-* scale)
- Frameless window with custom titlebar
- preflight.js native module auto-rebuild
- OS idle notifications via Electron Notification API
- Native CLI execution (PowerShell on Windows, default shell on macOS/Linux)

### What is GENUINELY NEW in Forge

| Feature | Description | Not in any source |
|---------|-------------|-------------------|
| **Workspace model** | Project folder = unit of organization, not chat group | ✓ |
| **Agent Graph** | SVG node graph showing running agents, data flow, token usage | ✓ |
| **Intent-based routing** | Type a task description → system routes to correct CLI automatically | ✓ |
| **Continuation Engine** | Ralph Loop baked into the main process IPC layer | ✓ |
| **SpawnBar** | Unified "describe task + auto-route + spawn" input | ✓ |
| **Per-workspace memory** | BM25 search on SQLite FTS5, scoped to project | ✓ |
| **Skills panel** | Load SKILL.md from workspace, rendered in sidebar | ✓ |
| **Multi-tab agent terminals** | One terminal per agent, not per CLI type | ✓ |
| **Workspace tabs** | Multiple projects open simultaneously | ✓ |

---

## PART III: ARCHITECTURE

### System Diagram

```
┌─────────────────────────────────────────────────────────┐
│  Electron Main Process                                   │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ Workspace│  │  Memory  │  │  Agent   │  │  PTY   │  │
│  │  Manager │  │  (BM25)  │  │  Router  │  │ Manager│  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       │              │              │             │       │
│  ┌────▼─────────────▼──────────────▼─────────────▼────┐  │
│  │              SQLite (WAL) — forge.db                │  │
│  │  workspaces | agent_sessions | workspace_memories   │  │
│  │  continuation_state | scheduled_tasks               │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Continuation Engine (Ralph Loop equivalent)        │  │
│  │  Watches PTY output → auto-sends next action         │  │
│  │  until DONE signal or max iterations                 │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
              ↕ contextBridge IPC (preload.ts)
┌─────────────────────────────────────────────────────────┐
│  React Renderer (Vite 6)                                │
│                                                         │
│  WorkspaceContext ─── AgentContext                      │
│                                                         │
│  TitleBar [workspace tabs | window controls]            │
│  ┌──────────────┬────────────────────────────────────┐  │
│  │   Sidebar    │        Terminal Area               │  │
│  │  ┌─────────┐ │  [tab: claude] [tab: gemini] [+]  │  │
│  │  │ Agents  │ │  ┌──────────────────────────────┐ │  │
│  │  │ Graph   │ │  │    xterm.js terminal panel   │ │  │
│  │  │ Memory  │ │  │    (active PTY session)      │ │  │
│  │  │ Skills  │ │  └──────────────────────────────┘ │  │
│  │  └─────────┘ │  SpawnBar [Auto|Claude|Gemini|...] │  │
│  └──────────────┴────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
              ↕ Native CLI (PowerShell on Windows)
┌─────────────────────────────────────────────────────────┐
│  CLI Tools (installed via PATH)                         │
│  claude / gemini / codex / copilot / qwen / llm         │
│  (running in workspace directory)                       │
└─────────────────────────────────────────────────────────┘
```

### Key Concepts

**Workspace** — A project directory opened in Forge. Each workspace has:
- Isolated memory (BM25 SQLite FTS5)
- Its own set of active agent sessions
- Skills loaded from `.forge/skills/` and `.claude/skills/`
- AGENTS.md / CLAUDE.md context injected into agents

**Agent Session** — A PTY process running a CLI (claude/gemini/codex/etc.) in the workspace directory. Each agent:
- Has a goal (optional, from SpawnBar)
- Has a continuation state (iteration count, max, status)
- Has a terminal panel in the UI

**Continuation Engine** — Background watcher in main.ts:
- Watches PTY output for quiet periods (12s default)
- If agent is at an idle prompt AND no DONE signal seen:
  - Interactive mode: send `continue\n`
  - One-shot loop mode: send full command (for example `claude -p "task"`)
- Increments iteration counter, notifies renderer
- Stops when: DONE signal detected, max iterations reached, or user cancels

**Task Router** — Classifies a natural-language description into CLI + category:
- `deep` → claude (planning, architecture, complex bugs)
- `visual` → gemini (frontend, CSS, components)
- `code` → codex (completion, boilerplate, tests)
- `git` → copilot (commits, PRs, GitHub)
- `local` → llm (private/offline)
- `research` → claude (docs, explanation)
- Default → claude

**Skills** — SKILL.md files in workspace or global dirs:
- Loaded by `workspace:getSkills()` IPC call
- Shown in Skills panel in sidebar
- Future: inject skill system prompts into agent PTY sessions

**Memory** — BM25-ranked SQLite FTS5:
- `memory:store(workspaceId, key, content, category)` — save a fact
- `memory:search(workspaceId, query)` — ranked search
- `memory:list(workspaceId)` — all memories for workspace
- Categories: `core` (permanent), `daily` (session), `conversation` (archived)

---

## PART IV: DATA MODEL

### Database: `~/.forge/forge.db` (SQLite WAL)

```sql
workspaces
  id TEXT PK         -- sha256(path)[0:16]
  path TEXT UNIQUE   -- absolute path on host
  name TEXT          -- basename(path)
  last_opened TEXT
  pinned INTEGER
  config TEXT        -- JSON blob for future settings

agent_sessions
  id TEXT PK
  workspace_id TEXT FK → workspaces.id
  cli_type TEXT      -- claude | gemini | codex | copilot | qwen | llm
  goal TEXT          -- user's task description (optional)
  status TEXT        -- active | ended
  iteration_count INTEGER
  token_input INTEGER
  token_output INTEGER
  started_at TEXT
  ended_at TEXT

workspace_memories
  id INTEGER PK AUTOINCREMENT
  workspace_id TEXT
  key TEXT           -- fact identifier
  content TEXT       -- fact content (BM25-indexed)
  category TEXT      -- core | daily | conversation
  created_at TEXT
  updated_at TEXT
  UNIQUE(workspace_id, key)

memories_fts          -- FTS5 virtual table (BM25)
  key, content
  Triggers: ai/au/ad maintain sync with workspace_memories

scheduled_tasks
  id TEXT PK
  workspace_id TEXT FK
  prompt TEXT
  cli_type TEXT
  schedule_type TEXT -- cron | interval | once
  schedule_value TEXT
  status TEXT
  next_run TEXT
  last_run TEXT

continuation_state
  pty_id TEXT PK
  workspace_id TEXT
  goal TEXT
  max_iterations INTEGER
  current_iteration INTEGER
  status TEXT
  started_at TEXT
```

### File System Layout

```
~/.forge/
├── forge.db            # Main SQLite database
└── skills/             # Global skills (all workspaces)
    └── {name}/
        └── SKILL.md

{workspace}/
├── .forge/
│   ├── skills/         # Workspace-specific skills
│   │   └── {name}/
│   │       └── SKILL.md
│   └── AGENTS.md       # Context auto-loaded for all agents
├── AGENTS.md           # Also checked (same as CLAUDE.md compatibility)
└── CLAUDE.md           # Claude Code compatibility
```

---

## PART V: IPC API SURFACE

| Channel | Direction | Description |
|---------|-----------|-------------|
| `workspace:open(path)` | invoke | Open/register workspace, load skills + AGENTS.md |
| `workspace:list()` | invoke | Recent workspaces (last 20) |
| `workspace:get(id)` | invoke | Get a specific workspace by id |
| `workspace:pickDirectory()` | invoke | Native folder picker dialog |
| `workspace:getSkills(path)` | invoke | Load SKILL.md files |
| `workspace:getAgentsMd(path)` | invoke | Load AGENTS.md / CLAUDE.md |
| `workspace:activeSessions(id)` | invoke | DB sessions for workspace |
| `memory:store(wid, key, content, cat)` | invoke | Upsert memory |
| `memory:search(wid, query)` | invoke | BM25 search |
| `memory:list(wid, cat?)` | invoke | List all memories |
| `memory:delete(wid, key)` | invoke | Delete memory |
| `agent:route(description, preferred?)` | invoke | Get CLI routing suggestion |
| `shell:spawn(cli, path, wid, goal?, oneShotLoop?)` | invoke | Start PTY session (interactive CLI or persistent shell for one-shot loops) |
| `shell:list()` | invoke | List active in-memory PTY sessions |
| `shell:openExternal(url)` | invoke | Open trusted external HTTP(S) URL |
| `shell:openPath(path)` | invoke | Open path in OS file explorer (creates path if missing) |
| `shell:write(ptyId, data)` | send | Write to PTY |
| `shell:resize(ptyId, cols, rows)` | send | Resize PTY |
| `shell:kill(ptyId)` | invoke | Kill PTY |
| `shell:data` | event → renderer | PTY output chunk |
| `shell:exit` | event → renderer | PTY exited |
| `continuation:start(ptyId, wid, goal, max)` | invoke | Start Ralph Loop |
| `continuation:stop(ptyId)` | invoke | Cancel loop |
| `continuation:state(ptyId)` | invoke | Get current state |
| `continuation:iteration` | event → renderer | Agent continued |
| `continuation:done` | event → renderer | Agent signalled DONE |
| `continuation:maxReached` | event → renderer | Hit iteration limit |
| `ensemble:synthesis(workspaceId, workspacePath, goal, n)` | invoke | Run Best-of-N hidden Claude runs for a workspace and return a resumable synthesis session id |
| `window:minimize/maximize/close` | send | Window controls |

---

## PART VI: SKILLS SYSTEM

Skills are Markdown files with YAML frontmatter. Forge searches these locations (priority order):

```
{workspace}/.forge/skills/*/SKILL.md   (highest — workspace-specific)
{workspace}/.claude/skills/*/SKILL.md  (Claude Code compat)
{workspace}/.opencode/skills/*/SKILL.md (OpenCode compat)
~/.forge/skills/*/SKILL.md             (global — all workspaces)
```

### SKILL.md Format

```yaml
---
name: Git Master
description: Expert git historian with commit style detection
tier: optional   # or required
mcp:             # MCP servers this skill activates (Phase 2)
  github-search:
    command: npx
    args: ["-y", "grep-app-mcp"]
---

# Git Master

You are a git historian and commit architect. Before any git operation:
1. Run `git log --oneline -10` to detect the project's commit style
2. Match the style exactly (conventional commits, imperative, etc.)
3. For 3+ files: always split into multiple logical commits
```

---

## PART VII: CONTINUATION ENGINE DESIGN

Inspired by oh-my-opencode's **Ralph Loop**. Implemented natively in Electron main process.

### Flow

```
User spawns agent with goal: "Implement auth middleware"
  ↓
continuation:start(ptyId, workspaceId, "Implement auth middleware", maxIterations=20)
  ↓
Main process watches PTY output:
  - Any output → reset 12s quiet timer
  - After 12s quiet:
      Check last 5 lines for idle prompt pattern (❯, $, >, claude>)
      Check if DONE signal seen (<promise>DONE</promise>, "all tasks completed", etc.)
      If DONE → emit continuation:done, stop
      If at prompt AND not done:
        increment iteration
        write next action to PTY
        (interactive mode uses "continue\n"; one-shot mode uses full command)
        emit continuation:iteration to renderer
        reschedule check
      If iteration >= max:
        emit continuation:maxReached
        stop
```

### Renderer Integration

- SpawnBar: has "Start Loop" option when spawning with a goal
- Agent tab: orange pulsing dot when continuation active
- Sidebar Agents panel: shows "Loop 3/20" with Stop button
- Agent Graph: orange pulsing ring around node when continuation active

---

## PART VIII: IMPLEMENTATION ROADMAP

### Phase 0 — Foundation ✓ (current)
- [x] Electron + React + Vite + Tailwind scaffold
- [x] SQLite database with workspaces, memories, agent_sessions tables
- [x] BM25 memory (FTS5 virtual table + triggers)
- [x] PTY management (spawn, write, resize, kill)
- [x] Workspace management (open, list, getSkills, getAgentsMd)
- [x] Task router (pattern-based CLI selection)
- [x] Continuation engine (Ralph Loop equivalent)
- [x] Agent Graph (SVG visualization)
- [x] TitleBar + Sidebar + Terminal + SpawnBar + AgentGraph components
- [x] preload.ts with full typed API surface

### Phase 1 — Polish & Usability
- [ ] Install dependencies (`npm install`)
- [ ] Test dev mode (`npm run dev`)
- [ ] Keyboard shortcuts (Alt+1-8 for agent tabs, Ctrl+Shift+P command palette)
- [ ] Terminal search (Ctrl+F)
- [ ] Font size controls (Ctrl++/-/0)
- [ ] Session persistence across app restarts
- [ ] Error states and empty states

### Phase 2 — Skills & Memory UX
- [ ] SKILL.md injection into agent system prompts
- [ ] MCP-embedded skills (SKILL.md `mcp:` section)
- [ ] Memory auto-suggest (show relevant memories when spawning)
- [ ] Memory categories (core/daily/conversation) with auto-archiving
- [ ] Cross-workspace memory sharing (opt-in)

### Phase 3 — Agent Intelligence
- [ ] Hashline edit tool (from oh-my-opencode — 68.3% vs 6.7% success rate)
- [ ] LSP integration (on-demand tsserver/pyright/gopls — 6 tools)
- [ ] Per-agent git worktree isolation (from pynchy)
- [ ] Hierarchical AGENTS.md generation (/init-deep equivalent)
- [ ] Agent handoff protocol (/handoff equivalent)

### Phase 4 — Orchestration
- [ ] Multi-agent task decomposition (Sisyphus pattern)
- [ ] Background agents (fire and retrieve)
- [ ] Specialized agent roles (planner → coder → reviewer → tester)
- [ ] Token budget tracking and LiteLLM proxy (from pynchy)
- [ ] Scheduled tasks (cron/interval)

### Phase 5 — Distribution
- [ ] Windows portable build
- [ ] macOS dmg + zip
- [ ] Auto-update
- [ ] Workspace templates (NextJS team, Python API team, Rust systems team)

---

## PART IX: TECH STACK DECISIONS

| Decision | Choice | Why NOT alternatives |
|----------|--------|----------------------|
| Runtime | Electron 35 | Native OS integration (PTY, notifications, file dialogs) |
| Frontend | React 18 + Vite 6 | Proven, fast HMR, rich ecosystem |
| Styling | Tailwind CSS 3.4 | Utility-first, consistent with existing tooling |
| Terminal | xterm.js 5 | Best-in-class web terminal, xterm-compatible |
| PTY | @lydell/node-pty | Best maintained fork, WSL-compatible |
| Database | better-sqlite3 WAL | Synchronous API, FTS5 support, battle-tested in claw-fusion |
| Language | TypeScript strict | Type safety for IPC APIs, preload bridge |
| Agent Graph | Pure SVG | No D3 dependency, simpler, full control |
| CLIs | Native (PowerShell on Windows) | CLIs run natively via PATH, no WSL dependency |
| Memory | SQLite FTS5 BM25 | No external deps (vs Elasticsearch), fast enough, native |
| Skills | SKILL.md (file-based) | Zero-config, compatible with Claude Code + OpenCode |
| Config | electron-store | Simple, works in Electron, no YAML sprawl |

---

## PART X: DESIGN SYSTEM

GitHub dark theme — all explicit hex values:

| Token | Value | Use |
|-------|-------|-----|
| `bg` | `#0d1117` | Page background |
| `surface` | `#161b22` | Cards, panels, sidebar |
| `surface-hover` | `#1c2128` | Hover states |
| `border-primary` | `#21262d` | Main borders |
| `border-subtle` | `#30363d` | Secondary borders |
| `text-primary` | `#e6edf3` | Main text |
| `text-secondary` | `#8b949e` | Labels, descriptions |
| `text-muted` | `#484f58` | Hints, placeholders |

Agent brand colors:

| CLI | Color | Hex |
|-----|-------|-----|
| Claude | Blue | `#60a5fa` |
| Gemini | Purple | `#a855f7` |
| Codex | Green | `#22c55e` |
| Copilot | Orange | `#f97316` |
| Qwen | Pink | `#ec4899` |
| LLM | Emerald | `#10b981` |

---

## APPENDIX: SOURCE ANALYSIS SUMMARIES

| Project | LoC | Key Innovation | Borrowed |
|---------|-----|----------------|----------|
| OpenClaw | ~404k TS | Multi-channel agent routing, Channel Dock | Routing concept |
| NanoClaw | ~6.6k TS | Container isolation, deterministic skills | Skills system, per-workspace CLAUDE.md |
| oh-my-opencode | ~31k TS | Ralph Loop, hashline edit, LSP tools | Continuation engine, intent classification |
| pynchy | Python | BM25 memory, LiteLLM gateway, git worktrees | Memory backend, workspace isolation model |
| ai-cli-switcher | ~Electron | Multi-CLI terminal, PTY management | Core stack, UX patterns |
| **Forge** | **New** | **Workspace model + Agent Graph + Intent Router** | **All of the above** |
