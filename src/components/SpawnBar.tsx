import React, { useState, useRef, useEffect } from 'react'
import { useWorkspace } from '../contexts/WorkspaceContext'

const CLI_OPTIONS = [
  { id: 'claude', label: 'Claude', color: '#60a5fa' },
  { id: 'gemini', label: 'Gemini', color: '#a855f7' },
  { id: 'codex', label: 'Codex', color: '#22c55e' },
  { id: 'copilot', label: 'Copilot', color: '#f97316' },
  { id: 'qwen', label: 'Qwen', color: '#ec4899' },
  { id: 'llm', label: 'Local LLM', color: '#10b981' },
]

interface SpawnBarProps {
  onSpawned: (ptyId: string) => void
}

export default function SpawnBar({ onSpawned }: SpawnBarProps) {
  const { spawnAgent, activeWorkspace, lastRouteResult } = useWorkspace()
  const [goal, setGoal] = useState('')
  const [selectedCli, setSelectedCli] = useState<string | null>(null)  // null = auto-route
  const [spawning, setSpawning] = useState(false)
  const [routeHint, setRouteHint] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-route suggestion as user types
  useEffect(() => {
    if (!goal.trim() || selectedCli) { setRouteHint(null); return }
    const timeout = setTimeout(async () => {
      const result = await window.agent.route(goal)
      setRouteHint(`→ ${result.cli} (${result.category}): ${result.rationale}`)
    }, 400)
    return () => clearTimeout(timeout)
  }, [goal, selectedCli])

  const handleSpawn = async () => {
    if (!activeWorkspace || spawning) return
    setSpawning(true)
    try {
      let cli = selectedCli
      if (!cli) {
        const result = await window.agent.route(goal)
        cli = result.cli
      }
      const ptyId = await spawnAgent(cli, goal.trim() || undefined)
      if (ptyId) {
        onSpawned(ptyId)
        setGoal('')
        setSelectedCli(null)
        setRouteHint(null)
      }
    } finally {
      setSpawning(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) handleSpawn()
  }

  if (!activeWorkspace) return null

  return (
    <div className="border-t border-border-primary bg-surface p-2 shrink-0">
      <div className="flex items-center gap-2">
        {/* CLI selector — auto or manual */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedCli(null)}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              selectedCli === null
                ? 'bg-surface-hover text-text-primary border border-border-subtle'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Auto
          </button>
          {CLI_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => setSelectedCli(selectedCli === opt.id ? null : opt.id)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                selectedCli === opt.id
                  ? 'bg-surface-hover border border-border-subtle'
                  : 'text-text-muted hover:text-text-primary'
              }`}
              style={{ color: selectedCli === opt.id ? opt.color : undefined }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Goal input */}
        <input
          ref={inputRef}
          type="text"
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Describe task or just hit Enter to open a shell…"
          className="flex-1 bg-bg border border-border-primary rounded px-3 py-1.5 text-xs text-text-primary placeholder-text-muted outline-none focus:border-border-subtle"
        />

        {/* Spawn button */}
        <button
          onClick={handleSpawn}
          disabled={spawning || !activeWorkspace}
          className="px-3 py-1.5 bg-surface-hover border border-border-subtle rounded text-xs text-text-primary hover:border-border-primary transition-colors disabled:opacity-50"
        >
          {spawning ? '…' : '⚒ Spawn'}
        </button>
      </div>

      {/* Route hint */}
      {routeHint && (
        <div className="mt-1 text-xs text-text-muted px-2">{routeHint}</div>
      )}
    </div>
  )
}
