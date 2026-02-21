import React, { useState, useRef, useEffect } from 'react'
import { useWorkspace } from '../contexts/WorkspaceContext'
import { CLI_OPTIONS } from '../constants'

interface SpawnBarProps {
  onSpawned: (ptyId: string) => void
}

export default function SpawnBar({ onSpawned }: SpawnBarProps) {
  const { spawnAgent, activeWorkspace, routeTask } = useWorkspace()
  const [goal, setGoal] = useState('')
  const [selectedCli, setSelectedCli] = useState<string | null>(null)  // null = auto-route
  const [spawning, setSpawning] = useState(false)
  const [startSynthesis, setStartSynthesis] = useState(false)
  const [loopCount, setLoopCount] = useState(5)
  const [routeHint, setRouteHint] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-route suggestion as user types
  useEffect(() => {
    if (!goal.trim() || selectedCli) { setRouteHint(null); return }
    const timeout = setTimeout(async () => {
      const result = await routeTask(goal)
      setRouteHint(`→ ${result.cli} (${result.category}): ${result.rationale}`)
    }, 400)
    return () => clearTimeout(timeout)
  }, [goal, selectedCli, routeTask])

  const handleSpawn = async () => {
    if (!activeWorkspace || spawning) return
    setSpawning(true)
    try {
      let cli: string = selectedCli ?? ''
      if (!cli) {
        const result = await routeTask(goal)
        cli = result.cli
      }
      const trimmedGoal = goal.trim() || undefined

      // Synthesis mode: run hidden best-of-N in background and then open a
      // new resumed Claude tab for the final synthesized session.
      if (startSynthesis && trimmedGoal) {
        const count = Math.max(1, Math.min(12, loopCount))
        const result = await window.ensemble.run(activeWorkspace.id, activeWorkspace.path, trimmedGoal, count)
        if ('ok' in result && result.ok && result.sessionId) {
          const resumedPtyId = await spawnAgent(
            'claude',
            undefined,
            undefined,
            {
              resumeSessionId: result.sessionId,
              tabTitle: `session ${result.sessionId}`,
            }
          )
          if (resumedPtyId) {
            onSpawned(resumedPtyId)
          }
        }
        setGoal('')
        setSelectedCli(null)
        setRouteHint(null)
        setStartSynthesis(false)
        return
      }

      const ptyId = await spawnAgent(
        cli,
        trimmedGoal,
        undefined
      )
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
            className={`px-2 py-1 rounded text-sm transition-colors ${
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
              className={`px-2 py-1 rounded text-sm transition-colors ${
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
          className="flex-1 bg-bg border border-border-primary rounded px-3 py-1.5 text-sm text-text-primary placeholder-text-muted outline-none focus:border-border-subtle"
        />

        {/* Spawn button */}
        <button
          onClick={handleSpawn}
          disabled={spawning || !activeWorkspace}
          className="px-3 py-1.5 bg-surface-hover border border-border-subtle rounded text-sm text-text-primary hover:border-border-primary transition-colors disabled:opacity-50"
        >
          {spawning ? '…' : '⚒ Spawn'}
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setStartSynthesis(v => !v)
            }}
            className={`px-3 py-1.5 rounded text-sm border transition-colors ${
              startSynthesis
                ? 'bg-purple-500/20 border-purple-500 text-purple-300'
                : 'border-border-primary text-text-muted hover:text-text-primary'
            }`}
            title="Best-of-N synthesis run"
          >
            Synthesis
          </button>

          {startSynthesis && (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={loopCount}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  const clamped = Number.isFinite(n) ? Math.max(1, Math.min(12, n)) : 5
                  setLoopCount(clamped)
                }}
                className="w-16 bg-bg border border-border-primary rounded px-2 py-1 text-sm text-center"
                min="1"
                max="12"
              />
              <span className="text-xs text-text-muted">parallel runs</span>
            </div>
          )}
        </div>
      </div>

      {/* Route hint */}
      {routeHint && (
        <div className="mt-1 text-sm text-text-muted px-2">{routeHint}</div>
      )}
    </div>
  )
}
