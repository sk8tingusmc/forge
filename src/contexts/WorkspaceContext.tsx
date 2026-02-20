import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { WorkspaceInfo, WorkspaceOpenResult, SkillDef, MemoryRow, RouteResult } from '../../electron/preload'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentSession {
  ptyId: string
  sessionId: string
  cliType: string
  workspaceId: string
  goal?: string
  status: 'spawning' | 'running' | 'idle' | 'dead'
  continuationActive: boolean
  continuationIteration: number
  continuationMax: number
}

export interface WorkspaceState {
  id: string
  path: string
  name: string
  skills: SkillDef[]
  agentsMd: string | null
  activeAgents: AgentSession[]  // agents running in this workspace
}

interface WorkspaceContextValue {
  // Workspace management
  workspaces: WorkspaceInfo[]
  activeWorkspaceId: string | null
  activeWorkspace: WorkspaceState | null
  openWorkspace(dirPath: string): Promise<void>
  pickAndOpen(): Promise<void>
  switchWorkspace(id: string): void
  refreshWorkspaces(): Promise<void>

  // Agent sessions
  agents: Record<string, AgentSession>  // keyed by ptyId
  spawnAgent(cliType: string, goal?: string, preferredCli?: string): Promise<string | null>
  killAgent(ptyId: string): Promise<void>
  getRouteResult(): Promise<RouteResult | null>
  lastRouteResult: RouteResult | null

  // Memory
  storeMemory(key: string, content: string, category?: string): Promise<void>
  searchMemory(query: string): Promise<MemoryRow[]>
  memories: MemoryRow[]
  refreshMemories(): Promise<void>

  // Continuation
  startContinuation(ptyId: string, goal: string, maxIterations?: number): Promise<void>
  stopContinuation(ptyId: string): Promise<void>
}

// ── Context ───────────────────────────────────────────────────────────────────

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [workspaceStates, setWorkspaceStates] = useState<Record<string, WorkspaceState>>({})
  const [agents, setAgents] = useState<Record<string, AgentSession>>({})
  const [memories, setMemories] = useState<MemoryRow[]>([])
  const [lastRouteResult, setLastRouteResult] = useState<RouteResult | null>(null)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  const activeWorkspace = activeWorkspaceId ? workspaceStates[activeWorkspaceId] ?? null : null

  // Refresh workspace list on mount
  useEffect(() => {
    refreshWorkspaces()
  }, [])

  // Subscribe to shell events
  useEffect(() => {
    const offData = window.shell.onData((ptyId, _data) => {
      if (!isMounted.current) return
      setAgents(prev => {
        if (!prev[ptyId]) return prev
        return { ...prev, [ptyId]: { ...prev[ptyId], status: 'running' } }
      })
    })
    const offExit = window.shell.onExit((ptyId, _code) => {
      if (!isMounted.current) return
      setAgents(prev => {
        if (!prev[ptyId]) return prev
        return { ...prev, [ptyId]: { ...prev[ptyId], status: 'dead' } }
      })
    })
    return () => { offData(); offExit() }
  }, [])

  // Subscribe to continuation events
  useEffect(() => {
    const offIteration = window.continuation.onIteration(({ ptyId, iteration, max }) => {
      if (!isMounted.current) return
      setAgents(prev => {
        if (!prev[ptyId]) return prev
        return { ...prev, [ptyId]: { ...prev[ptyId], continuationIteration: iteration, continuationMax: max, continuationActive: true } }
      })
    })
    const offDone = window.continuation.onDone(({ ptyId }) => {
      if (!isMounted.current) return
      setAgents(prev => {
        if (!prev[ptyId]) return prev
        return { ...prev, [ptyId]: { ...prev[ptyId], continuationActive: false } }
      })
    })
    const offMax = window.continuation.onMaxReached(({ ptyId }) => {
      if (!isMounted.current) return
      setAgents(prev => {
        if (!prev[ptyId]) return prev
        return { ...prev, [ptyId]: { ...prev[ptyId], continuationActive: false, status: 'idle' } }
      })
    })
    return () => { offIteration(); offDone(); offMax() }
  }, [])

  const refreshWorkspaces = useCallback(async () => {
    const list = await window.workspace.list()
    if (isMounted.current) setWorkspaces(list)
  }, [])

  const openWorkspace = useCallback(async (dirPath: string) => {
    const result: WorkspaceOpenResult = await window.workspace.open(dirPath)
    if ('error' in result && result.error) return

    const ws: WorkspaceState = {
      id: result.id,
      path: result.path,
      name: result.name,
      skills: result.skills ?? [],
      agentsMd: result.agentsMd ?? null,
      activeAgents: [],
    }
    setWorkspaceStates(prev => ({ ...prev, [result.id]: ws }))
    setActiveWorkspaceId(result.id)
    await refreshWorkspaces()
  }, [refreshWorkspaces])

  const pickAndOpen = useCallback(async () => {
    const dir = await window.workspace.pickDirectory()
    if (dir) await openWorkspace(dir)
  }, [openWorkspace])

  const switchWorkspace = useCallback((id: string) => {
    setActiveWorkspaceId(id)
  }, [])

  const spawnAgent = useCallback(async (cliType: string, goal?: string, _preferredCli?: string): Promise<string | null> => {
    if (!activeWorkspace) return null

    const result = await window.shell.spawn(cliType, activeWorkspace.path, activeWorkspace.id, goal)
    if ('error' in result) return null

    const { ptyId, sessionId } = result as { ptyId: string; sessionId: string }

    const session: AgentSession = {
      ptyId,
      sessionId,
      cliType,
      workspaceId: activeWorkspace.id,
      goal,
      status: 'spawning',
      continuationActive: false,
      continuationIteration: 0,
      continuationMax: 20,
    }
    setAgents(prev => ({ ...prev, [ptyId]: session }))
    return ptyId
  }, [activeWorkspace])

  const killAgent = useCallback(async (ptyId: string) => {
    await window.shell.kill(ptyId)
    setAgents(prev => {
      const next = { ...prev }
      delete next[ptyId]
      return next
    })
  }, [])

  const getRouteResult = useCallback(async (): Promise<RouteResult | null> => {
    return lastRouteResult
  }, [lastRouteResult])

  const storeMemory = useCallback(async (key: string, content: string, category?: string) => {
    if (!activeWorkspaceId) return
    await window.memory.store(activeWorkspaceId, key, content, category)
    await refreshMemories()
  }, [activeWorkspaceId])

  const searchMemory = useCallback(async (query: string): Promise<MemoryRow[]> => {
    if (!activeWorkspaceId) return []
    return window.memory.search(activeWorkspaceId, query)
  }, [activeWorkspaceId])

  const refreshMemories = useCallback(async () => {
    if (!activeWorkspaceId || !isMounted.current) return
    const list = await window.memory.list(activeWorkspaceId)
    if (isMounted.current) setMemories(list)
  }, [activeWorkspaceId])

  // Refresh memories when workspace changes
  useEffect(() => {
    if (activeWorkspaceId) refreshMemories()
  }, [activeWorkspaceId, refreshMemories])

  const startContinuation = useCallback(async (ptyId: string, goal: string, maxIterations = 20) => {
    if (!activeWorkspaceId) return
    await window.continuation.start(ptyId, activeWorkspaceId, goal, maxIterations)
    setAgents(prev => {
      if (!prev[ptyId]) return prev
      return { ...prev, [ptyId]: { ...prev[ptyId], continuationActive: true, continuationMax: maxIterations, goal } }
    })
  }, [activeWorkspaceId])

  const stopContinuation = useCallback(async (ptyId: string) => {
    await window.continuation.stop(ptyId)
    setAgents(prev => {
      if (!prev[ptyId]) return prev
      return { ...prev, [ptyId]: { ...prev[ptyId], continuationActive: false } }
    })
  }, [])

  const value: WorkspaceContextValue = {
    workspaces, activeWorkspaceId, activeWorkspace,
    openWorkspace, pickAndOpen, switchWorkspace, refreshWorkspaces,
    agents, spawnAgent, killAgent, getRouteResult, lastRouteResult,
    storeMemory, searchMemory, memories, refreshMemories,
    startContinuation, stopContinuation,
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
