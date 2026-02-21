import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { WorkspaceInfo, WorkspaceOpenResult, SkillDef, MemoryRow, RouteResult } from '../../electron/preload.ts'

// -- Types --------------------------------------------------------------------

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

export interface SynthesisJob {
  id: string
  workspaceId: string
  goal: string
  completed: number
  total: number
  status: 'running' | 'done'
  sessionId?: string
}

export interface WorkspaceState {
  id: string
  path: string
  name: string
  skills: SkillDef[]
  agentsMd: string | null
  activeAgents: AgentSession[]
}

export interface SpawnAgentOptions {
  oneShotLoop?: boolean
  shellSession?: boolean
  resumeSessionId?: string
  tabTitle?: string
}

interface WorkspaceContextValue {
  workspaces: WorkspaceInfo[]
  activeWorkspaceId: string | null
  activeWorkspace: WorkspaceState | null
  openWorkspace(dirPath: string): Promise<void>
  pickAndOpen(): Promise<void>
  switchWorkspace(id: string): void
  refreshWorkspaces(): Promise<void>

  agents: Record<string, AgentSession>
  synthesisJobs: Record<string, SynthesisJob>
  spawnAgent(
    cliType: string,
    goal?: string,
    preferredCli?: string,
    options?: SpawnAgentOptions
  ): Promise<string | null>
  killAgent(ptyId: string): Promise<void>
  routeTask(description: string, preferredCli?: string): Promise<RouteResult>
  lastRouteResult: RouteResult | null

  storeMemory(key: string, content: string, category?: string): Promise<void>
  searchMemory(query: string): Promise<MemoryRow[]>
  memories: MemoryRow[]
  refreshMemories(): Promise<void>

  startContinuation(ptyId: string, goal: string, maxIterations?: number): Promise<void>
  stopContinuation(ptyId: string): Promise<void>
}

// -- Context ------------------------------------------------------------------

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}

// -- Provider -----------------------------------------------------------------

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [workspaceStates, setWorkspaceStates] = useState<Record<string, WorkspaceState>>({})
  const [agents, setAgents] = useState<Record<string, AgentSession>>({})
  const [synthesisJobs, setSynthesisJobs] = useState<Record<string, SynthesisJob>>({})
  const [memories, setMemories] = useState<MemoryRow[]>([])
  const [lastRouteResult, setLastRouteResult] = useState<RouteResult | null>(null)
  const isMounted = useRef(true)
  const hasAutoRestored = useRef(false)

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  const activeWorkspace = activeWorkspaceId ? workspaceStates[activeWorkspaceId] ?? null : null

  // Refresh workspace list on mount
  useEffect(() => {
    refreshWorkspaces()
  }, [])

  // Auto-restore the most recently used workspace on mount
  useEffect(() => {
    if (hasAutoRestored.current || workspaces.length === 0 || activeWorkspaceId) return
    hasAutoRestored.current = true
    // workspaces are already sorted by last_opened DESC from the DB query
    const mostRecent = workspaces[0]
    if (mostRecent) {
      openWorkspace(mostRecent.path).catch(() => {
        // Directory may no longer exist — ignore and let user pick manually
      })
    }
  }, [workspaces, activeWorkspaceId])

  // Subscribe to shell events
  useEffect(() => {
    const offData = window.shell.onData((ptyId: string, _data: string) => {
      if (!isMounted.current) return
      setAgents(prev => {
        if (!prev[ptyId]) return prev
        return { ...prev, [ptyId]: { ...prev[ptyId], status: 'running' } }
      })
    })
    const offExit = window.shell.onExit((ptyId: string, _code: number) => {
      if (!isMounted.current) return
      setAgents(prev => {
        if (!prev[ptyId]) return prev
        return { ...prev, [ptyId]: { ...prev[ptyId], status: 'dead' } }
      })
    })
    return () => { offData(); offExit() }
  }, [])

  // Subscribe to continuation + synthesis events
  useEffect(() => {
    const offIteration = window.continuation.onIteration((info: { ptyId: string; iteration: number; max: number }) => {
      if (!isMounted.current) return
      setAgents(prev => {
        if (!prev[info.ptyId]) return prev
        return { ...prev, [info.ptyId]: { ...prev[info.ptyId], continuationIteration: info.iteration, continuationMax: info.max, continuationActive: true } }
      })
    })
    const offDone = window.continuation.onDone((info: { ptyId: string; iterations: number }) => {
      if (!isMounted.current) return
      setAgents(prev => {
        if (!prev[info.ptyId]) return prev
        return { ...prev, [info.ptyId]: { ...prev[info.ptyId], continuationActive: false } }
      })
    })
    const offMax = window.continuation.onMaxReached((info: { ptyId: string; iterations: number; goal: string }) => {
      if (!isMounted.current) return
      setAgents(prev => {
        if (!prev[info.ptyId]) return prev
        return { ...prev, [info.ptyId]: { ...prev[info.ptyId], continuationActive: false, status: 'idle' } }
      })
    })
    const offSynthesisProgress = window.ensemble.onProgress((info: { jobId: string; workspaceId: string; goal: string; completed: number; total: number }) => {
      if (!isMounted.current) return
      setSynthesisJobs(prev => {
        return {
          ...prev,
          [info.jobId]: {
            id: info.jobId,
            workspaceId: info.workspaceId,
            goal: info.goal,
            completed: info.completed,
            total: info.total,
            status: 'running',
          },
        }
      })
    })
    const offSynthesisDone = window.ensemble.onDone((info: { jobId: string; workspaceId: string; goal: string; sessionId: string; total: number }) => {
      if (!isMounted.current) return
      setSynthesisJobs(prev => {
        const existing = prev[info.jobId]
        return {
          ...prev,
          [info.jobId]: {
            ...existing,
            id: info.jobId,
            workspaceId: info.workspaceId,
            goal: info.goal,
            completed: info.total,
            total: info.total,
            status: 'done',
            sessionId: info.sessionId,
          },
        }
      })
    })
    return () => {
      offIteration()
      offDone()
      offMax()
      offSynthesisProgress()
      offSynthesisDone()
    }
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
    // If workspace state is already loaded, just switch to it
    if (workspaceStates[id]) {
      setActiveWorkspaceId(id)
      return
    }
    // Otherwise find the path from the workspace list and open it fully
    const ws = workspaces.find(w => w.id === id)
    if (ws) {
      openWorkspace(ws.path)
    }
  }, [workspaceStates, workspaces, openWorkspace])

  const spawnAgent = useCallback(async (
    cliType: string,
    goal?: string,
    _preferredCli?: string,
    options?: SpawnAgentOptions
  ): Promise<string | null> => {
    if (!activeWorkspace) return null

    const result = await window.shell.spawn(
      cliType,
      activeWorkspace.path,
      activeWorkspace.id,
      goal,
      options?.oneShotLoop ?? false,
      options?.shellSession ?? false,
      options?.resumeSessionId
    )
    if ('error' in result) return null

    const { ptyId, sessionId } = result as { ptyId: string; sessionId: string }

    const session: AgentSession = {
      ptyId,
      sessionId,
      cliType,
      workspaceId: activeWorkspace.id,
      goal: options?.tabTitle ?? goal,
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

  const routeTask = useCallback(async (description: string, preferredCli?: string): Promise<RouteResult> => {
    const result = await window.agent.route(description, preferredCli)
    if (isMounted.current) setLastRouteResult(result)
    return result
  }, [])

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
    agents, synthesisJobs, spawnAgent, killAgent, routeTask, lastRouteResult,
    storeMemory, searchMemory, memories, refreshMemories,
    startContinuation, stopContinuation,
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
