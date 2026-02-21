import Database from 'better-sqlite3'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

let db: Database.Database

// Cached prepared statements — initialized after DB is ready
let stmts: ReturnType<typeof prepareStatements>

export function getDb(): Database.Database {
  return db
}

export function initDatabase(): void {
  const dataDir = path.join(os.homedir(), '.forge')
  fs.mkdirSync(dataDir, { recursive: true })

  db = new Database(path.join(dataDir, 'forge.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('cache_size = -8000')

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      last_opened TEXT DEFAULT (datetime('now')),
      pinned INTEGER DEFAULT 0,
      config TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      cli_type TEXT NOT NULL,
      goal TEXT,
      status TEXT DEFAULT 'active',
      iteration_count INTEGER DEFAULT 0,
      token_input INTEGER DEFAULT 0,
      token_output INTEGER DEFAULT 0,
      started_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    CREATE TABLE IF NOT EXISTS workspace_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_id TEXT NOT NULL,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'core',
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(workspace_id, key)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      key,
      content,
      content=workspace_memories,
      content_rowid=id
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON workspace_memories BEGIN
      INSERT INTO memories_fts(rowid, key, content) VALUES (new.id, new.key, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON workspace_memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, key, content) VALUES ('delete', old.id, old.key, old.content);
      INSERT INTO memories_fts(rowid, key, content) VALUES (new.id, new.key, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON workspace_memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, key, content) VALUES ('delete', old.id, old.key, old.content);
    END;

    CREATE TABLE IF NOT EXISTS continuation_state (
      pty_id TEXT PRIMARY KEY,
      workspace_id TEXT,
      goal TEXT,
      max_iterations INTEGER DEFAULT 20,
      current_iteration INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      started_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cli_type TEXT NOT NULL,
      schedule_type TEXT NOT NULL, -- cron | interval | once
      schedule_value TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      next_run TEXT,
      last_run TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
  `)

  stmts = prepareStatements()
}

function prepareStatements() {
  return {
    upsertWorkspace: db.prepare(`
      INSERT INTO workspaces (id, path, name, last_opened)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(path) DO UPDATE SET last_opened = datetime('now'), id = excluded.id
    `),
    listWorkspaces: db.prepare(`
      SELECT id, path, name, last_opened as lastOpened, pinned, config
      FROM workspaces ORDER BY pinned DESC, last_opened DESC LIMIT 20
    `),
    getWorkspaceById: db.prepare(`
      SELECT id, path, name, last_opened as lastOpened, pinned, config
      FROM workspaces WHERE id = ?
    `),
    storeMemory: db.prepare(`
      INSERT INTO workspace_memories (workspace_id, key, content, category, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(workspace_id, key) DO UPDATE SET
        content = excluded.content, category = excluded.category, updated_at = datetime('now')
    `),
    searchMemoryFts: db.prepare(`
      SELECT m.id, m.key, m.content, m.category, m.created_at as createdAt
      FROM workspace_memories m
      JOIN memories_fts f ON m.id = f.rowid
      WHERE m.workspace_id = ? AND memories_fts MATCH ?
      ORDER BY rank LIMIT 10
    `),
    searchMemoryLike: db.prepare(`
      SELECT id, key, content, category, created_at as createdAt
      FROM workspace_memories
      WHERE workspace_id = ? AND (key LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
      ORDER BY updated_at DESC LIMIT 10
    `),
    listMemories: db.prepare(`
      SELECT id, key, content, category, created_at as createdAt
      FROM workspace_memories WHERE workspace_id = ? ORDER BY updated_at DESC
    `),
    listMemoriesByCategory: db.prepare(`
      SELECT id, key, content, category, created_at as createdAt
      FROM workspace_memories WHERE workspace_id = ? AND category = ? ORDER BY updated_at DESC
    `),
    deleteMemory: db.prepare(`
      DELETE FROM workspace_memories WHERE workspace_id = ? AND key = ?
    `),
    createAgentSession: db.prepare(`
      INSERT INTO agent_sessions (id, workspace_id, cli_type, goal) VALUES (?, ?, ?, ?)
    `),
    endAgentSession: db.prepare(`
      UPDATE agent_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?
    `),
    incrementSessionIteration: db.prepare(`
      UPDATE agent_sessions SET iteration_count = iteration_count + 1 WHERE id = ?
    `),
    listActiveSessions: db.prepare(`
      SELECT id, workspace_id as workspaceId, cli_type as cliType, goal, status,
             iteration_count as iterationCount, token_input as tokenInput, token_output as tokenOutput,
             started_at as startedAt, ended_at as endedAt
      FROM agent_sessions WHERE workspace_id = ? AND status = 'active' ORDER BY started_at DESC
    `),
    saveContinuationState: db.prepare(`
      INSERT INTO continuation_state (pty_id, workspace_id, goal, max_iterations, current_iteration, status, started_at)
      VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))
      ON CONFLICT(pty_id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        goal = excluded.goal,
        max_iterations = excluded.max_iterations,
        current_iteration = excluded.current_iteration,
        status = 'active',
        started_at = datetime('now')
    `),
    updateContinuationIteration: db.prepare(`
      UPDATE continuation_state
      SET current_iteration = ?, status = 'active'
      WHERE pty_id = ?
    `),
    deleteContinuationState: db.prepare(`
      DELETE FROM continuation_state WHERE pty_id = ?
    `),
  }
}

// -- Workspace queries --------------------------------------------------------

export interface WorkspaceRow {
  id: string
  path: string
  name: string
  lastOpened: string
  pinned: number
  config: string
}

export function upsertWorkspace(id: string, dirPath: string, name: string): void {
  stmts.upsertWorkspace.run(id, dirPath, name)
}

export function listWorkspaces(): WorkspaceRow[] {
  return stmts.listWorkspaces.all() as WorkspaceRow[]
}

export function getWorkspaceById(id: string): WorkspaceRow | undefined {
  return stmts.getWorkspaceById.get(id) as WorkspaceRow | undefined
}

// -- Memory queries (BM25) ----------------------------------------------------

export interface MemoryRow {
  id: number
  key: string
  content: string
  category: string
  createdAt: string
}

export function storeMemory(workspaceId: string, key: string, content: string, category = 'core'): void {
  stmts.storeMemory.run(workspaceId, key, content, category)
}

/** Escape LIKE special characters so user input is matched literally */
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

export function searchMemory(workspaceId: string, query: string): MemoryRow[] {
  // Try BM25 FTS first — only catch FTS syntax errors, not arbitrary failures
  try {
    const ftsResults = stmts.searchMemoryFts.all(workspaceId, query) as MemoryRow[]
    if (ftsResults.length > 0) return ftsResults
  } catch (err: unknown) {
    // FTS5 MATCH syntax error (e.g. unbalanced quotes) — fall through to LIKE
    const message = err instanceof Error ? err.message : ''
    if (!message.includes('fts5: syntax error')) {
      // Re-throw unexpected errors instead of swallowing them
      throw err
    }
  }

  // Fallback to LIKE with properly escaped wildcards
  const escaped = escapeLike(query)
  const pattern = `%${escaped}%`
  return stmts.searchMemoryLike.all(workspaceId, pattern, pattern) as MemoryRow[]
}

export function listMemories(workspaceId: string, category?: string): MemoryRow[] {
  if (category) {
    return stmts.listMemoriesByCategory.all(workspaceId, category) as MemoryRow[]
  }
  return stmts.listMemories.all(workspaceId) as MemoryRow[]
}

export function deleteMemory(workspaceId: string, key: string): void {
  stmts.deleteMemory.run(workspaceId, key)
}

// -- Agent session queries ----------------------------------------------------

export interface AgentSessionRow {
  id: string
  workspaceId: string
  cliType: string
  goal: string | null
  status: string
  iterationCount: number
  tokenInput: number
  tokenOutput: number
  startedAt: string
  endedAt: string | null
}

export function createAgentSession(id: string, workspaceId: string, cliType: string, goal?: string): void {
  stmts.createAgentSession.run(id, workspaceId, cliType, goal ?? null)
}

export function endAgentSession(id: string): void {
  stmts.endAgentSession.run(id)
}

export function incrementSessionIteration(id: string): void {
  stmts.incrementSessionIteration.run(id)
}

export function listActiveSessions(workspaceId: string): AgentSessionRow[] {
  return stmts.listActiveSessions.all(workspaceId) as AgentSessionRow[]
}

// -- Continuation state -------------------------------------------------------

export function saveContinuationState(
  ptyId: string, workspaceId: string, goal: string, maxIterations: number, iteration: number
): void {
  stmts.saveContinuationState.run(ptyId, workspaceId, goal, maxIterations, iteration)
}

export function updateContinuationIteration(ptyId: string, iteration: number): void {
  stmts.updateContinuationIteration.run(iteration, ptyId)
}

export function deleteContinuationState(ptyId: string): void {
  stmts.deleteContinuationState.run(ptyId)
}
