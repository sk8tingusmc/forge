import React, { useState, useCallback, useEffect } from 'react'
import { WorkspaceProvider, useWorkspace } from './contexts/WorkspaceContext'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import Terminal from './components/Terminal'
import SpawnBar from './components/SpawnBar'

// ── Terminal tab bar ──────────────────────────────────────────────────────────

const CLI_COLORS: Record<string, string> = {
  claude: '#60a5fa', gemini: '#a855f7', codex: '#22c55e',
  copilot: '#f97316', qwen: '#ec4899', llm: '#10b981',
}

function TerminalArea() {
  const { agents, activeWorkspace, killAgent } = useWorkspace()
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [tabs, setTabs] = useState<string[]>([])

  // Keep tabs in sync with agents
  useEffect(() => {
    const wsAgents = Object.values(agents)
      .filter(a => a.workspaceId === activeWorkspace?.id && a.status !== 'dead')
      .map(a => a.ptyId)

    setTabs(prev => {
      const merged = [...new Set([...prev.filter(id => wsAgents.includes(id)), ...wsAgents])]
      return merged
    })

    // If active tab died, switch to last alive
    if (activeTab && !wsAgents.includes(activeTab)) {
      setActiveTab(wsAgents[wsAgents.length - 1] ?? null)
    }
    // Auto-select first tab when none selected
    if (!activeTab && wsAgents.length > 0) {
      setActiveTab(wsAgents[wsAgents.length - 1])
    }
  }, [agents, activeWorkspace?.id])

  const handleSpawned = useCallback((ptyId: string) => {
    setActiveTab(ptyId)
  }, [])

  const handleCloseTab = useCallback(async (ptyId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await killAgent(ptyId)
    setTabs(prev => prev.filter(id => id !== ptyId))
    if (activeTab === ptyId) {
      const remaining = tabs.filter(id => id !== ptyId)
      setActiveTab(remaining[remaining.length - 1] ?? null)
    }
  }, [tabs, activeTab, killAgent])

  if (!activeWorkspace) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-bg text-text-muted gap-4">
        <span className="text-5xl opacity-20">⚒</span>
        <div className="text-center">
          <p className="text-text-secondary font-bold text-lg mb-1">Welcome to Forge</p>
          <p className="text-sm">Open a workspace to get started</p>
        </div>
        <OpenWorkspaceButton />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab bar */}
      {tabs.length > 0 && (
        <div className="flex items-center h-8 bg-surface border-b border-border-primary overflow-x-auto shrink-0">
          {tabs.map(ptyId => {
            const agent = agents[ptyId]
            if (!agent) return null
            const color = CLI_COLORS[agent.cliType] ?? '#8b949e'
            const isActive = activeTab === ptyId

            return (
              <div
                key={ptyId}
                onClick={() => setActiveTab(ptyId)}
                className={`
                  flex items-center gap-2 px-3 h-full cursor-pointer shrink-0 border-r border-border-primary
                  transition-colors relative
                  ${isActive ? 'bg-bg text-text-primary' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'}
                `}
              >
                {isActive && (
                  <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: color }} />
                )}
                <span className="text-xs font-bold" style={{ color }}>{agent.cliType}</span>
                {agent.goal && (
                  <span className="text-xs text-text-muted max-w-[100px] truncate">{agent.goal}</span>
                )}
                {agent.continuationActive && (
                  <span className="text-xs text-orange-400 animate-pulse-orange">●</span>
                )}
                <button
                  onClick={(e) => handleCloseTab(ptyId, e)}
                  className="text-text-muted hover:text-text-primary ml-1 text-xs"
                >✕</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Terminal panels */}
      <div className="flex-1 overflow-hidden relative">
        {tabs.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted gap-3">
            <span className="text-text-muted opacity-40 text-3xl">⚒</span>
            <p className="text-xs">Spawn an agent below to start working</p>
          </div>
        )}
        {tabs.map(ptyId => (
          <div
            key={ptyId}
            className="absolute inset-0"
            style={{ display: activeTab === ptyId ? 'block' : 'none' }}
          >
            <Terminal
              ptyId={ptyId}
              cliType={agents[ptyId]?.cliType ?? 'claude'}
              active={activeTab === ptyId}
            />
          </div>
        ))}
      </div>

      {/* Spawn bar */}
      <SpawnBar onSpawned={handleSpawned} />
    </div>
  )
}

function OpenWorkspaceButton() {
  const { pickAndOpen } = useWorkspace()
  return (
    <button
      onClick={pickAndOpen}
      className="px-4 py-2 bg-surface-hover border border-border-subtle rounded text-sm text-text-primary hover:border-border-primary transition-colors"
    >
      📁 Open Workspace
    </button>
  )
}

// ── Root layout ───────────────────────────────────────────────────────────────

function ForgeApp() {
  const { activeWorkspace } = useWorkspace()

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg text-text-primary">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        {activeWorkspace && <Sidebar />}
        <TerminalArea />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <WorkspaceProvider>
      <ForgeApp />
    </WorkspaceProvider>
  )
}
