// Global type definitions — SINGLE SOURCE OF TRUTH for window APIs

import type {
  ShellAPI, WorkspaceAPI, MemoryAPI, AgentAPI, ContinuationAPI, AppAPI, EnsembleAPI
} from '../electron/preload.ts'

declare global {
  interface Window {
    shell: ShellAPI
    workspace: WorkspaceAPI
    memory: MemoryAPI
    agent: AgentAPI
    continuation: ContinuationAPI
    appControls: AppAPI
    ensemble: EnsembleAPI
  }
}

export {}
