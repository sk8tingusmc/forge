import React, { useMemo } from 'react'
import { useWorkspace } from '../contexts/WorkspaceContext'
import type { AgentSession } from '../contexts/WorkspaceContext'
import { CLI_COLORS, STATUS_COLORS } from '../constants'

interface NodeLayout {
  id: string
  x: number
  y: number
  agent: AgentSession
}

function layoutNodes(agents: AgentSession[], width: number, height: number): NodeLayout[] {
  const list = agents.filter(a => a.status !== 'dead')
  if (list.length === 0) return []

  const cx = width / 2
  const cy = height / 2
  const r = Math.min(cx, cy) * 0.65

  return list.map((agent, i) => {
    const angle = (2 * Math.PI * i) / list.length - Math.PI / 2
    return {
      id: agent.ptyId,
      x: list.length === 1 ? cx : cx + r * Math.cos(angle),
      y: list.length === 1 ? cy : cy + r * Math.sin(angle),
      agent,
    }
  })
}

interface AgentNodeProps {
  layout: NodeLayout
  onKill: (ptyId: string) => void
  onToggleContinuation: (ptyId: string) => void
}

function AgentNode({ layout, onKill, onToggleContinuation }: AgentNodeProps) {
  const { agent, x, y } = layout
  const color = CLI_COLORS[agent.cliType] ?? '#8b949e'
  const statusColor = STATUS_COLORS[agent.status] ?? '#8b949e'
  const R = 36

  return (
    <g transform={`translate(${x},${y})`}>
      {/* Continuation ring (pulsing when active) */}
      {agent.continuationActive && (
        <circle
          r={R + 8}
          fill="none"
          stroke="#f97316"
          strokeWidth={2}
          opacity={0.6}
          style={{ animation: 'pulse-orange 1.5s ease-in-out infinite' }}
        />
      )}

      {/* Main circle */}
      <circle
        r={R}
        fill="#161b22"
        stroke={color}
        strokeWidth={2}
        style={{ cursor: 'pointer' }}
      />

      {/* Status dot */}
      <circle
        cx={R - 6}
        cy={-(R - 6)}
        r={5}
        fill={statusColor}
      />

      {/* CLI label */}
      <text
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize={11}
        fontFamily="monospace"
        fontWeight="bold"
        dy={-6}
      >
        {agent.cliType}
      </text>

      {/* Status label */}
      <text
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#8b949e"
        fontSize={9}
        fontFamily="monospace"
        dy={8}
      >
        {agent.status}
      </text>

      {/* Continuation iteration */}
      {agent.continuationActive && (
        <text
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#f97316"
          fontSize={9}
          fontFamily="monospace"
          dy={20}
        >
          {agent.continuationIteration}/{agent.continuationMax}
        </text>
      )}

      {/* Goal tooltip (truncated below) */}
      {agent.goal && (
        <text
          textAnchor="middle"
          fill="#484f58"
          fontSize={9}
          fontFamily="monospace"
          y={R + 14}
        >
          {agent.goal.slice(0, 20)}{agent.goal.length > 20 ? '…' : ''}
        </text>
      )}

      {/* Kill button (hover area) */}
      <circle
        r={R}
        fill="transparent"
        style={{ cursor: 'pointer' }}
        onDoubleClick={() => onKill(agent.ptyId)}
      >
        <title>Double-click to kill agent</title>
      </circle>
    </g>
  )
}

export default function AgentGraph() {
  const { agents, killAgent, startContinuation, stopContinuation, activeWorkspace } = useWorkspace()

  const agentList = Object.values(agents).filter(a => a.workspaceId === activeWorkspace?.id)

  const width = 320
  const height = 240
  const layouts = useMemo(() => layoutNodes(agentList, width, height), [agentList])

  const handleKill = async (ptyId: string) => {
    await killAgent(ptyId)
  }

  const handleToggleContinuation = async (ptyId: string) => {
    const agent = agents[ptyId]
    if (!agent) return
    if (agent.continuationActive) {
      await stopContinuation(ptyId)
    } else if (agent.goal) {
      await startContinuation(ptyId, agent.goal)
    }
  }

  if (agentList.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full text-text-muted text-xs gap-2">
        <span className="text-2xl opacity-30">⚒</span>
        <span>No active agents</span>
        <span className="text-text-muted opacity-60">Spawn an agent to see the graph</span>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="px-3 py-2 text-xs text-text-secondary border-b border-border-primary flex items-center justify-between">
        <span>Agent Graph</span>
        <span className="text-text-muted">{agentList.filter(a => a.status !== 'dead').length} active</span>
      </div>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="flex-1"
      >
        <style>{`
          @keyframes pulse-orange {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
        `}</style>

        {/* Draw edges for continuation relationships */}
        {layouts.length > 1 && layouts.map((from, i) => {
          const to = layouts[(i + 1) % layouts.length]
          return (
            <line
              key={`edge-${from.id}-${to.id}`}
              x1={from.x} y1={from.y}
              x2={to.x} y2={to.y}
              stroke="#21262d"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )
        })}

        {/* Agent nodes */}
        {layouts.map(layout => (
          <AgentNode
            key={layout.id}
            layout={layout}
            onKill={handleKill}
            onToggleContinuation={handleToggleContinuation}
          />
        ))}
      </svg>

      <div className="px-3 py-1.5 text-xs text-text-muted border-t border-border-primary">
        Double-click node to kill · Continuation = orange ring
      </div>
    </div>
  )
}
