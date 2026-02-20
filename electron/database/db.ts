import Database from 'better-sqlite3'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

let db: Database.Database

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
    -- Workspaces (open project directories)
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      last_opened TEXT DEFAULT (datetime('now')),
      pinned INTEGER DEFAULT 0,
      config TEXT DEFAULT '{}'
    );

    -- Per-workspace agent sessions (PTY sessions linked to a workspace + goal)
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

    -- Per-workspace persistent memory (BM25 via FTS5)
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

    -- Scheduled tasks per workspace
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cli_type TEXT DEFAULT 'claude',
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      next_run TEXT,
      last_run TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );

    -- Continuation state (persisted across window refreshes)
    CREATE TABLE IF NOT EXISTS continuation_state (
      pty_id TEXT PRIMARY KEY,
      workspace_id TEXT,
      goal TEXT,
      max_iterations INTEGER DEFAULT 20,
      current_iteration INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      started_at TEXT DEFAULT (datetime('now'))
    );
  `)
}

// ── Workspace queries ──────────────────────────────────────────────────────────

export interface WorkspaceRow {
  id: string
  path: string
  name: string
  lastOpened: string
  pinned: number
  config: string
}

export function upsertWorkspace(id: string, dirPath: string, name: string): void {
  db.prepare(`
    INSERT INTO workspaces (id, path, name, last_opened)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET last_opened = datetime('now'), id = excluded.id
  `).run(id, dirPath, name)
}

export function listWorkspaces(): WorkspaceRow[] {
  return db.prepare(`
    SELECT id, path, name, last_opened as lastOpened, pinned, config
    FROM workspaces ORDER BY pinned DESC, last_opened DESC LIMIT 20
  `).all() as WorkspaceRow[]
}

export function getWorkspaceById(id: string): WorkspaceRow | undefined {
  return db.prepare(`SELECT id, path, name, last_opened as lastOpened, pinned, config FROM workspaces WHERE id = ?`).get(id) as WorkspaceRow | undefined
}

// ── Memory queries (BM25) ──────────────────────────────────────────────────────

export interface MemoryRow {
  id: number
  key: string
  content: string
  category: string
  createdAt: string
}

export function storeMemory(workspaceId: string, key: string, content: string, category = 'core'): void {
  db.prepare(`
    INSERT INTO workspace_memories (workspace_id, key, content, category, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workspace_id, key) DO UPDATE SET content = excluded.content, category = excluded.category, updated_at = datetime('now')
  `).run(workspaceId, key, content, category)
}

export function searchMemory(workspaceId: string, query: string): MemoryRow[] {
  // Try BM25 FTS first
  try {
    const ftsResults = db.prepare(`
      SELECT m.id, m.key, m.content, m.category, m.created_at as createdAt
      FROM workspace_memories m
      JOIN memories_fts f ON m.id = f.rowid
      WHERE m.workspace_id = ? AND memories_fts MATCH ?
      ORDER BY rank LIMIT 10
    `).all(workspaceId, query) as MemoryRow[]
    if (ftsResults.length > 0) return ftsResults
  } catch {}

  // Fallback to LIKE
  return db.prepare(`
    SELECT id, key, content, category, created_at as createdAt
    FROM workspace_memories
    WHERE workspace_id = ? AND (key LIKE ? OR content LIKE ?)
    ORDER BY updated_at DESC LIMIT 10
  `).all(workspaceId, `%${query}%`, `%${query}%`) as MemoryRow[]
}

export function listMemories(workspaceId: string, category?: string): MemoryRow[] {
  if (category) {
    return db.prepare(`
      SELECT id, key, content, category, created_at as createdAt
      FROM workspace_memories WHERE workspace_id = ? AND category = ? ORDER BY updated_at DESC
    `).all(workspaceId, category) as MemoryRow[]
  }
  return db.prepare(`
    SELECT id, key, content, category, created_at as createdAt
    FROM workspace_memories WHERE workspace_id = ? ORDER BY updated_at DESC
  `).all(workspaceId) as MemoryRow[]
}

export function deleteMemory(workspaceId: string, key: string): void {
  db.prepare(`DELETE FROM workspace_memories WHERE workspace_id = ? AND key = ?`).run(workspaceId, key)
}

// ── Agent session queries ──────────────────────────────────────────────────────

export function createAgentSession(id: string, workspaceId: string, cliType: string, goal?: string): void {
  db.prepare(`
    INSERT INTO agent_sessions (id, workspace_id, cli_type, goal) VALUES (?, ?, ?, ?)
  `).run(id, workspaceId, cliType, goal ?? null)
}

export function endAgentSession(id: string): void {
  db.prepare(`UPDATE agent_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?`).run(id)
}

export function incrementSessionIteration(id: string): void {
  db.prepare(`UPDATE agent_sessions SET iteration_count = iteration_count + 1 WHERE id = ?`).run(id)
}

export function listActiveSessions(workspaceId: string): unknown[] {
  return db.prepare(`
    SELECT * FROM agent_sessions WHERE workspace_id = ? AND status = 'active' ORDER BY started_at DESC
  `).all(workspaceId)
}

// ── Continuation state ────────────────────────────────────────────────────────

export function saveContinuationState(
  ptyId: string, workspaceId: string, goal: string, maxIterations: number, iteration: number
): void {
  db.prepare(`
    INSERT INTO continuation_state (pty_id, workspace_id, goal, max_iterations, current_iteration)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(pty_id) DO UPDATE SET current_iteration = excluded.current_iteration
  `).run(ptyId, workspaceId, goal, maxIterations, iteration)
}

export function deleteContinuationState(ptyId: string): void {
  db.prepare(`DELETE FROM continuation_state WHERE pty_id = ?`).run(ptyId)
}
