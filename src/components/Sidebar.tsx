import React, { useState } from 'react'
import { useWorkspace } from '../contexts/WorkspaceContext'
import type { AgentSession } from '../contexts/WorkspaceContext'
import AgentGraph from './AgentGraph'
import { CLI_COLORS } from '../constants'

type SidebarTab = 'agents' | 'memory' | 'skills' | 'graph'

// ── Agents panel ──────────────────────────────────────────────────────────────

function AgentsPanel() {
  const { agents, synthesisJobs, activeWorkspace, killAgent } = useWorkspace()
  const list = Object.values(agents).filter(a => a.workspaceId === activeWorkspace?.id)
  const jobs = Object.values(synthesisJobs).filter(j => j.workspaceId === activeWorkspace?.id)

  if (list.length === 0 && jobs.length === 0) {
    return <div className="p-3 text-sm text-text-muted">No active agents. Spawn one using the bar below.</div>
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {jobs.map(job => (
        <div key={job.id} className="bg-bg rounded border border-border-primary p-2 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${job.status === 'done' ? 'bg-green-400' : 'bg-purple-400 animate-pulse-orange'}`} />
              <span className="text-sm font-bold text-purple-300">synthesis</span>
              <span className="text-sm text-text-muted">{job.status}</span>
            </div>
            <span className="text-sm text-text-muted font-mono">{job.id.slice(-6)}</span>
          </div>
          <div className="text-sm text-text-secondary truncate" title={job.goal}>{job.goal}</div>
          <div className="text-sm text-purple-300">
            Synthesis {job.completed}/{job.total}
          </div>
          {job.sessionId && (
            <div className="text-xs text-text-muted truncate" title={job.sessionId}>
              session {job.sessionId}
            </div>
          )}
        </div>
      ))}
      {list.map(agent => (
        <AgentCard
          key={agent.ptyId}
          agent={agent}
          onKill={() => killAgent(agent.ptyId)}
        />
      ))}
    </div>
  )
}

function AgentCard({ agent, onKill }: {
  agent: AgentSession
  onKill: () => void
}) {
  const color = CLI_COLORS[agent.cliType] ?? '#8b949e'
  const statusDot = {
    spawning: 'bg-orange-400',
    running: 'bg-green-400',
    idle: 'bg-gray-500',
    dead: 'bg-red-800',
  }[agent.status] ?? 'bg-gray-600'

  return (
    <div className="bg-bg rounded border border-border-primary p-2 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-sm font-bold" style={{ color }}>{agent.cliType}</span>
          <span className="text-sm text-text-muted">{agent.status}</span>
        </div>
        <button
          onClick={onKill}
          className="text-sm text-text-muted hover:text-red-400 transition-colors px-1"
          title="Kill agent"
        >✕</button>
      </div>

      {agent.goal && (
        <div className="text-sm text-text-secondary truncate" title={agent.goal}>
          {agent.goal}
        </div>
      )}

      <div className="flex items-center justify-end mt-1">
        <span className="text-sm text-text-muted font-mono">{agent.ptyId.slice(-6)}</span>
      </div>
    </div>
  )
}

// ── Memory panel ──────────────────────────────────────────────────────────────

function MemoryPanel() {
  const { memories, storeMemory, searchMemory } = useWorkspace()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<typeof memories | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newContent, setNewContent] = useState('')
  const [adding, setAdding] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) { setResults(null); return }
    const r = await searchMemory(query)
    setResults(r)
  }

  const handleAdd = async () => {
    if (!newKey.trim() || !newContent.trim()) return
    await storeMemory(newKey.trim(), newContent.trim())
    setNewKey('')
    setNewContent('')
    setAdding(false)
  }

  const displayList = results ?? memories

  return (
    <div className="flex flex-col gap-2 p-2 h-full overflow-hidden">
      <div className="flex gap-1">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search memories…"
          className="flex-1 bg-bg border border-border-primary rounded px-2 py-1 text-sm outline-none focus:border-border-subtle"
        />
        <button onClick={handleSearch} className="px-2 py-1 bg-surface-hover rounded text-sm text-text-secondary hover:text-text-primary">
          🔍
        </button>
        <button onClick={() => setAdding(v => !v)} className="px-2 py-1 bg-surface-hover rounded text-sm text-text-secondary hover:text-text-primary">
          +
        </button>
      </div>

      {adding && (
        <div className="flex flex-col gap-1 bg-bg border border-border-primary rounded p-2">
          <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Key (e.g. 'auth strategy')" className="bg-transparent border border-border-primary rounded px-2 py-1 text-sm outline-none" />
          <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="Content…" rows={3} className="bg-transparent border border-border-primary rounded px-2 py-1 text-sm outline-none resize-none" />
          <div className="flex gap-1 justify-end">
            <button onClick={() => setAdding(false)} className="px-2 py-1 text-sm text-text-muted hover:text-text-primary">Cancel</button>
            <button onClick={handleAdd} className="px-2 py-1 bg-surface-hover rounded text-sm text-text-primary hover:bg-border-primary">Save</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col gap-1">
        {displayList.length === 0 && (
          <div className="text-sm text-text-muted p-2">
            {results !== null ? 'No results' : 'No memories yet. Add facts for agents to recall.'}
          </div>
        )}
        {displayList.map(m => (
          <div key={m.id} className="bg-bg border border-border-primary rounded p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold text-text-primary">{m.key}</span>
              <span className="text-sm text-text-muted">{m.category}</span>
            </div>
            <p
              className="text-sm text-text-secondary"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {m.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Skills panel ──────────────────────────────────────────────────────────────

function SkillsPanel() {
  const { activeWorkspace } = useWorkspace()
  const skills = activeWorkspace?.skills ?? []

  const handleOpenSkillsDir = async () => {
    if (!activeWorkspace) return
    const skillsDir = activeWorkspace.path + '/.forge/skills'
    await window.shell.openPath(skillsDir)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-primary">
        <span className="text-sm text-text-muted">{skills.length} skill{skills.length !== 1 ? 's' : ''}</span>
        <button
          onClick={handleOpenSkillsDir}
          className="px-2 py-0.5 bg-surface-hover rounded text-sm text-text-secondary hover:text-text-primary"
          title="Open skills folder"
        >+</button>
      </div>
      {skills.length === 0 ? (
        <div className="p-3 text-sm text-text-muted">
          <p>No skills found.</p>
          <p className="mt-1 text-text-muted opacity-70">Add SKILL.md files to <code className="bg-bg px-1 rounded">.forge/skills/</code> in your workspace.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1 p-2 overflow-y-auto flex-1">
          {skills.map(skill => (
            <div key={skill.path} className="bg-bg border border-border-primary rounded p-2">
              <div className="text-sm font-bold text-text-primary mb-0.5">{skill.name}</div>
              <div className="text-sm text-text-muted">{skill.description}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('agents')
  const { agents, synthesisJobs, activeWorkspace, memories } = useWorkspace()

  const agentCount = Object.values(agents).filter(a => a.workspaceId === activeWorkspace?.id && a.status !== 'dead').length
  const synthCount = Object.values(synthesisJobs).filter(j => j.workspaceId === activeWorkspace?.id && j.status === 'running').length
  const memCount = memories.length
  const skillCount = activeWorkspace?.skills.length ?? 0

  const tabs: Array<{ id: SidebarTab; label: string; badge?: number }> = [
    { id: 'agents', label: 'Agents', badge: (agentCount + synthCount) || undefined },
    { id: 'graph', label: 'Graph' },
    { id: 'memory', label: 'Memory', badge: memCount || undefined },
    { id: 'skills', label: 'Skills', badge: skillCount || undefined },
  ]

  return (
    <div className="flex flex-col h-full bg-surface border-r border-border-primary w-64 shrink-0">
      {/* Tab bar */}
      <div className="flex border-b border-border-primary">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 text-sm relative transition-colors ${
              activeTab === tab.id
                ? 'text-text-primary border-b-2 border-blue-500'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="ml-1 text-text-muted">({tab.badge})</span>
            )}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'agents' && <AgentsPanel />}
        {activeTab === 'graph' && (
          <div className="h-full">
            <AgentGraph />
          </div>
        )}
        {activeTab === 'memory' && <MemoryPanel />}
        {activeTab === 'skills' && <SkillsPanel />}
      </div>
    </div>
  )
}
