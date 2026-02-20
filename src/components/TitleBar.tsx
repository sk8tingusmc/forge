import React from 'react'
import { useWorkspace } from '../contexts/WorkspaceContext'

export default function TitleBar() {
  const { activeWorkspace, workspaces, switchWorkspace, pickAndOpen } = useWorkspace()

  return (
    <div className="titlebar-drag flex items-center h-10 bg-surface border-b border-border-primary select-none shrink-0">
      {/* App icon + name */}
      <div className="titlebar-no-drag flex items-center gap-2 px-4 w-48 shrink-0">
        <span className="text-orange-400 font-bold text-sm">⚒ Forge</span>
      </div>

      {/* Workspace tabs */}
      <div className="titlebar-no-drag flex items-center gap-1 flex-1 overflow-x-auto px-2 h-full">
        {workspaces.slice(0, 8).map(ws => (
          <button
            key={ws.id}
            onClick={() => switchWorkspace(ws.id)}
            className={`
              flex items-center gap-1.5 px-3 h-7 rounded text-xs shrink-0
              transition-colors
              ${activeWorkspace?.id === ws.id
                ? 'bg-surface-hover text-text-primary border border-border-subtle'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }
            `}
          >
            <span className="text-text-muted">📁</span>
            <span className="max-w-[120px] truncate">{ws.name}</span>
          </button>
        ))}

        {/* Open workspace button */}
        <button
          onClick={pickAndOpen}
          className="titlebar-no-drag flex items-center gap-1 px-3 h-7 rounded text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Open workspace (folder)"
        >
          <span>+</span>
          <span>Open</span>
        </button>
      </div>

      {/* Window controls */}
      <div className="titlebar-no-drag flex items-center gap-0 shrink-0 pr-2">
        <button
          onClick={() => window.appControls.minimize()}
          className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors text-xs"
        >─</button>
        <button
          onClick={() => window.appControls.maximize()}
          className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover rounded transition-colors text-xs"
        >□</button>
        <button
          onClick={() => window.appControls.close()}
          className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-[#f85149] hover:bg-surface-hover rounded transition-colors text-xs"
        >✕</button>
      </div>
    </div>
  )
}
