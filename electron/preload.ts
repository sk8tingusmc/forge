import { contextBridge, ipcRenderer } from 'electron'

// ── API Types ─────────────────────────────────────────────────────────────────

export interface WorkspaceInfo {
  id: string
  path: string
  name: string
  lastOpened: string
  pinned: number
}

export interface WorkspaceOpenResult {
  id: string
  path: string
  name: string
  skills: SkillDef[]
  agentsMd: string | null
  error?: string
}

export interface SkillDef {
  name: string
  description: string
  path: string
  content: string
}

export interface RouteResult {
  cli: string
  category: string
  rationale: string
  confidence: number
}

export interface MemoryRow {
  id: number
  key: string
  content: string
  category: string
  createdAt: string
}

export interface ContinuationInfo {
  ptyId: string
  goal: string
  iteration: number
  max: number
  status: string
}

// ── Shell API ─────────────────────────────────────────────────────────────────

export interface ShellAPI {
  spawn(
    cliType: string,
    workspacePath: string,
    workspaceId: string,
    goal?: string,
    oneShotLoop?: boolean,
    shellSession?: boolean,
    resumeSessionId?: string
  ): Promise<{ ptyId: string; sessionId: string } | { error: string }>
  write(ptyId: string, data: string): void
  resize(ptyId: string, cols: number, rows: number): void
  kill(ptyId: string): Promise<{ ok: boolean }>
  list(): Promise<Array<{ ptyId: string; workspaceId: string; cliType: string }>>
  onData(callback: (ptyId: string, data: string) => void): () => void
  onExit(callback: (ptyId: string, exitCode: number) => void): () => void
  openExternal(url: string): Promise<void>
  openPath(dirPath: string): Promise<string>
}

// ── Workspace API ─────────────────────────────────────────────────────────────

export interface WorkspaceAPI {
  open(dirPath: string): Promise<WorkspaceOpenResult>
  list(): Promise<WorkspaceInfo[]>
  get(id: string): Promise<WorkspaceInfo | undefined>
  pickDirectory(): Promise<string | null>
  getSkills(workspacePath: string): Promise<SkillDef[]>
  getAgentsMd(workspacePath: string): Promise<string | null>
  activeSessions(workspaceId: string): Promise<unknown[]>
}

// ── Memory API ────────────────────────────────────────────────────────────────

export interface MemoryAPI {
  store(workspaceId: string, key: string, content: string, category?: string): Promise<{ ok: boolean }>
  search(workspaceId: string, query: string): Promise<MemoryRow[]>
  list(workspaceId: string, category?: string): Promise<MemoryRow[]>
  delete(workspaceId: string, key: string): Promise<{ ok: boolean }>
}

// ── Agent API ─────────────────────────────────────────────────────────────────

export interface AgentAPI {
  route(description: string, preferredCli?: string): Promise<RouteResult>
}

// ── Continuation API ──────────────────────────────────────────────────────────

export interface ContinuationAPI {
  start(ptyId: string, workspaceId: string, goal: string, maxIterations?: number): Promise<{ ok: boolean } | { error: string }>
  stop(ptyId: string): Promise<{ ok: boolean }>
  getState(ptyId: string): Promise<ContinuationInfo | null>
  onIteration(callback: (info: { ptyId: string; iteration: number; max: number }) => void): () => void
  onDone(callback: (info: { ptyId: string; iterations: number }) => void): () => void
  onMaxReached(callback: (info: { ptyId: string; iterations: number; goal: string }) => void): () => void
}

// ── App API ───────────────────────────────────────────────────────────────────

export interface AppAPI {
  minimize(): void
  maximize(): void
  close(): void
}

export interface EnsembleAPI {
  run(workspaceId: string, workspacePath: string, goal: string, n: number): Promise<{ ok: boolean; count: number; sessionId: string; jobId: string } | { error: string }>
  onProgress(callback: (info: { jobId: string; workspaceId: string; goal: string; completed: number; total: number }) => void): () => void
  onDone(callback: (info: { jobId: string; workspaceId: string; goal: string; sessionId: string; total: number }) => void): () => void
}

// ── Implementations ───────────────────────────────────────────────────────────

const shellAPI: ShellAPI = {
  spawn: (cliType, workspacePath, workspaceId, goal, oneShotLoop, shellSession, resumeSessionId) =>
    ipcRenderer.invoke('shell:spawn', cliType, workspacePath, workspaceId, goal, oneShotLoop, shellSession, resumeSessionId),
  write: (ptyId, data) => ipcRenderer.send('shell:write', ptyId, data),
  resize: (ptyId, cols, rows) => ipcRenderer.send('shell:resize', ptyId, cols, rows),
  kill: (ptyId) => ipcRenderer.invoke('shell:kill', ptyId),
  list: () => ipcRenderer.invoke('shell:list'),
  onData: (cb) => {
    const listener = (_: unknown, ptyId: string, data: string) => cb(ptyId, data)
    ipcRenderer.on('shell:data', listener)
    return () => ipcRenderer.off('shell:data', listener)
  },
  onExit: (cb) => {
    const listener = (_: unknown, ptyId: string, code: number) => cb(ptyId, code)
    ipcRenderer.on('shell:exit', listener)
    return () => ipcRenderer.off('shell:exit', listener)
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (dirPath) => ipcRenderer.invoke('shell:openPath', dirPath),
}

const workspaceAPI: WorkspaceAPI = {
  open: (dirPath) => ipcRenderer.invoke('workspace:open', dirPath),
  list: () => ipcRenderer.invoke('workspace:list'),
  get: (id) => ipcRenderer.invoke('workspace:get', id),
  pickDirectory: () => ipcRenderer.invoke('workspace:pickDirectory'),
  getSkills: (workspacePath) => ipcRenderer.invoke('workspace:getSkills', workspacePath),
  getAgentsMd: (workspacePath) => ipcRenderer.invoke('workspace:getAgentsMd', workspacePath),
  activeSessions: (workspaceId) => ipcRenderer.invoke('workspace:activeSessions', workspaceId),
}

const memoryAPI: MemoryAPI = {
  store: (wid, key, content, cat) => ipcRenderer.invoke('memory:store', wid, key, content, cat),
  search: (wid, q) => ipcRenderer.invoke('memory:search', wid, q),
  list: (wid, cat) => ipcRenderer.invoke('memory:list', wid, cat),
  delete: (wid, key) => ipcRenderer.invoke('memory:delete', wid, key),
}

const agentAPI: AgentAPI = {
  route: (desc, preferred) => ipcRenderer.invoke('agent:route', desc, preferred),
}

const continuationAPI: ContinuationAPI = {
  start: (ptyId, wid, goal, max) => ipcRenderer.invoke('continuation:start', ptyId, wid, goal, max),
  stop: (ptyId) => ipcRenderer.invoke('continuation:stop', ptyId),
  getState: (ptyId) => ipcRenderer.invoke('continuation:state', ptyId),
  onIteration: (cb) => {
    const listener = (_: unknown, info: { ptyId: string; iteration: number; max: number }) => cb(info)
    ipcRenderer.on('continuation:iteration', listener)
    return () => ipcRenderer.off('continuation:iteration', listener)
  },
  onDone: (cb) => {
    const listener = (_: unknown, info: { ptyId: string; iterations: number }) => cb(info)
    ipcRenderer.on('continuation:done', listener)
    return () => ipcRenderer.off('continuation:done', listener)
  },
  onMaxReached: (cb) => {
    const listener = (_: unknown, info: { ptyId: string; iterations: number; goal: string }) => cb(info)
    ipcRenderer.on('continuation:maxReached', listener)
    return () => ipcRenderer.off('continuation:maxReached', listener)
  },
}

const appAPI: AppAPI = {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
}

const ensembleAPI: EnsembleAPI = {
  run: (workspaceId, workspacePath, goal, n) => ipcRenderer.invoke('ensemble:synthesis', workspaceId, workspacePath, goal, n),
  onProgress: (cb) => {
    const listener = (_: unknown, info: { jobId: string; workspaceId: string; goal: string; completed: number; total: number }) => cb(info)
    ipcRenderer.on('ensemble:progress', listener)
    return () => ipcRenderer.off('ensemble:progress', listener)
  },
  onDone: (cb) => {
    const listener = (_: unknown, info: { jobId: string; workspaceId: string; goal: string; sessionId: string; total: number }) => cb(info)
    ipcRenderer.on('ensemble:done', listener)
    return () => ipcRenderer.off('ensemble:done', listener)
  },
}

// ── Expose APIs ───────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('shell', shellAPI)
contextBridge.exposeInMainWorld('workspace', workspaceAPI)
contextBridge.exposeInMainWorld('memory', memoryAPI)
contextBridge.exposeInMainWorld('agent', agentAPI)
contextBridge.exposeInMainWorld('continuation', continuationAPI)
contextBridge.exposeInMainWorld('appControls', appAPI)
contextBridge.exposeInMainWorld('ensemble', ensembleAPI)
