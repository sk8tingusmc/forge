/**
 * Continuation Engine — inspired by oh-my-opencode's Ralph Loop
 *
 * Watches agent PTY sessions and automatically sends "continue\n" when an
 * agent goes quiet mid-task. Tracks a goal and iteration count.
 * Notifies the renderer when stuck or when max iterations is reached.
 */

import type { BrowserWindow } from 'electron'

// Prompt patterns that indicate the CLI is idle/waiting for input
const IDLE_PROMPT_PATTERNS = [
  /❯\s*$/,           // Claude Code prompt
  /\$\s*$/,           // Shell prompt
  />\s*$/,            // Generic prompt
  /claude>\s*$/i,
  /gemini>\s*$/i,
  /codex>\s*$/i,
]

// Completion signals — if agent output contains these, task is done
const DONE_PATTERNS = [
  /<promise>DONE<\/promise>/i,
  /\ball tasks completed\b/i,
  /\btask complete\b/i,
  /\bfinished successfully\b/i,
  /\bcompleted successfully\b/i,
]

export interface ContinuationState {
  ptyId: string
  goal: string
  maxIterations: number
  currentIteration: number
  status: 'running' | 'paused' | 'done' | 'max_reached' | 'cancelled'
  timer?: NodeJS.Timeout
  outputBuffer: string
}

const states = new Map<string, ContinuationState>()
const QUIET_DELAY_MS = 12_000  // 12s quiet → check if stuck

export function startContinuation(
  ptyId: string,
  goal: string,
  maxIterations: number,
  onContinue: (ptyId: string) => void,
  window: BrowserWindow
): void {
  stopContinuation(ptyId)  // Clear any existing state

  const state: ContinuationState = {
    ptyId,
    goal,
    maxIterations,
    currentIteration: 0,
    status: 'running',
    outputBuffer: '',
  }
  states.set(ptyId, state)
  scheduleCheck(state, onContinue, window)
}

export function stopContinuation(ptyId: string): void {
  const state = states.get(ptyId)
  if (state) {
    if (state.timer) clearTimeout(state.timer)
    state.status = 'cancelled'
    states.delete(ptyId)
  }
}

export function onPtyData(ptyId: string, data: string): void {
  const state = states.get(ptyId)
  if (!state || state.status !== 'running') return

  state.outputBuffer += data

  // Keep buffer bounded
  if (state.outputBuffer.length > 50_000) {
    state.outputBuffer = state.outputBuffer.slice(-20_000)
  }

  // Reset the quiet timer on any output
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = undefined
  }
}

function scheduleCheck(
  state: ContinuationState,
  onContinue: (ptyId: string) => void,
  window: BrowserWindow
): void {
  if (state.status !== 'running') return

  state.timer = setTimeout(() => {
    state.timer = undefined
    checkAndContinue(state, onContinue, window)
  }, QUIET_DELAY_MS)
}

function checkAndContinue(
  state: ContinuationState,
  onContinue: (ptyId: string) => void,
  window: BrowserWindow
): void {
  if (state.status !== 'running') return

  // Check if agent signalled completion
  if (DONE_PATTERNS.some(p => p.test(state.outputBuffer))) {
    state.status = 'done'
    states.delete(state.ptyId)
    window.webContents.send('continuation:done', { ptyId: state.ptyId, iterations: state.currentIteration })
    return
  }

  // Check if agent is at an idle prompt (ready for input mid-task)
  const lastLines = state.outputBuffer.split('\n').slice(-5).join('\n')
  const isAtPrompt = IDLE_PROMPT_PATTERNS.some(p => p.test(lastLines))
  if (!isAtPrompt) {
    // Still outputting, reschedule
    scheduleCheck(state, onContinue, window)
    return
  }

  // Max iterations guard
  if (state.currentIteration >= state.maxIterations) {
    state.status = 'max_reached'
    states.delete(state.ptyId)
    window.webContents.send('continuation:maxReached', {
      ptyId: state.ptyId,
      iterations: state.currentIteration,
      goal: state.goal,
    })
    return
  }

  // Auto-continue
  state.currentIteration++
  state.outputBuffer = ''  // Reset for next iteration
  window.webContents.send('continuation:iteration', {
    ptyId: state.ptyId,
    iteration: state.currentIteration,
    max: state.maxIterations,
  })
  onContinue(state.ptyId)

  // Schedule next check
  scheduleCheck(state, onContinue, window)
}

export function getContinuationState(ptyId: string): ContinuationState | undefined {
  return states.get(ptyId)
}

export function getAllStates(): Map<string, ContinuationState> {
  return states
}
