/**
 * Continuation Engine — inspired by oh-my-opencode's Ralph Loop
 *
 * Watches agent PTY sessions and automatically sends "continue\n" when an
 * agent goes quiet mid-task. Tracks a goal and iteration count.
 * Notifies the renderer when stuck or when max iterations is reached.
 */

import type { BrowserWindow } from 'electron'

export const ONE_SHOT_DONE_MARKER = '__FORGE_ONE_SHOT_DONE__'

// Prompt patterns that indicate the CLI is idle/waiting for input
const IDLE_PROMPT_PATTERNS = [
  /(?:^|\n)[^\n]*❯\s*$/,                 // Claude Code prompt
  /(?:^|\n)[^\n]*\$\s*$/,                 // POSIX shell prompt
  /(?:^|\n)[A-Za-z]:[^\n]*>\s*$/,         // Windows cmd prompt
  /(?:^|\n)(?:claude|gemini|codex)>\s*$/i,
  /(?:^|\n)__FORGE_ONE_SHOT_DONE__\s*$/,  // one-shot loop completion marker
  /(?:^|\n)>\s*$/,                        // Bare prompt used by some REPLs
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
  requirePrompt: boolean
  quietDelayMs: number
  timer?: NodeJS.Timeout
  outputBuffer: string
  // Store refs so onPtyData can reschedule the check timer
  onContinue: (ptyId: string) => void
  window: BrowserWindow
  hooks: ContinuationHooks
}

export interface ContinuationHooks {
  onIteration?: (info: { ptyId: string; iteration: number; max: number }) => void
  onDone?: (info: { ptyId: string; iterations: number }) => void
  onMaxReached?: (info: { ptyId: string; iterations: number; goal: string }) => void
  onCancelled?: (ptyId: string) => void
}

export interface ContinuationStartOptions {
  // Run first iteration immediately instead of waiting for quiet+prompt detection
  kickOff?: boolean
  // Some automation loops may continue without prompt checks
  requirePrompt?: boolean
  // Override quiet delay before checking for continuation
  quietDelayMs?: number
}

const states = new Map<string, ContinuationState>()
const QUIET_DELAY_MS = 12_000  // 12s quiet -> check if stuck
const MAX_BUFFER_SIZE = 50_000
const BUFFER_TRIM_TO = 20_000

export function startContinuation(
  ptyId: string,
  goal: string,
  maxIterations: number,
  onContinue: (ptyId: string) => void,
  window: BrowserWindow,
  hooks: ContinuationHooks = {},
  options: ContinuationStartOptions = {}
): void {
  stopContinuation(ptyId)  // Clear any existing state

  const state: ContinuationState = {
    ptyId,
    goal,
    maxIterations,
    currentIteration: 0,
    status: 'running',
    requirePrompt: options.requirePrompt ?? true,
    quietDelayMs: typeof options.quietDelayMs === 'number' && options.quietDelayMs >= 250
      ? options.quietDelayMs
      : QUIET_DELAY_MS,
    outputBuffer: '',
    onContinue,
    window,
    hooks,
  }
  states.set(ptyId, state)
  if (options.kickOff) {
    runIteration(state)
    return
  }
  scheduleCheck(state)
}

export function stopContinuation(ptyId: string): void {
  const state = states.get(ptyId)
  if (state) {
    if (state.timer) clearTimeout(state.timer)
    state.status = 'cancelled'
    state.hooks.onCancelled?.(ptyId)
    states.delete(ptyId)
  }
}

export function onPtyData(ptyId: string, data: string): void {
  const state = states.get(ptyId)
  if (!state || state.status !== 'running') return

  state.outputBuffer += data

  // Keep buffer bounded
  if (state.outputBuffer.length > MAX_BUFFER_SIZE) {
    state.outputBuffer = state.outputBuffer.slice(-BUFFER_TRIM_TO)
  }

  // Reset the quiet timer on any output and reschedule
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = undefined
  }
  scheduleCheck(state)
}

function scheduleCheck(state: ContinuationState): void {
  if (state.status !== 'running') return

  state.timer = setTimeout(() => {
    state.timer = undefined
    checkAndContinue(state)
  }, state.quietDelayMs)
}

function checkAndContinue(state: ContinuationState): void {
  if (state.status !== 'running') return

  const { window: win, onContinue } = state

  // Guard against destroyed window
  if (win.isDestroyed()) {
    stopContinuation(state.ptyId)
    return
  }

  // Check if agent signalled completion
  if (DONE_PATTERNS.some(p => p.test(state.outputBuffer))) {
    state.status = 'done'
    states.delete(state.ptyId)
    state.hooks.onDone?.({ ptyId: state.ptyId, iterations: state.currentIteration })
    win.webContents.send('continuation:done', { ptyId: state.ptyId, iterations: state.currentIteration })
    return
  }

  if (state.requirePrompt) {
    // Check if agent is at an idle prompt (ready for input mid-task)
    const lastLines = state.outputBuffer.split('\n').slice(-5).join('\n')
    const isAtPrompt = IDLE_PROMPT_PATTERNS.some(p => p.test(lastLines))
    if (!isAtPrompt) {
      // Still outputting, reschedule
      scheduleCheck(state)
      return
    }
  }

  // Max iterations guard
  runIteration(state)
}

function runIteration(state: ContinuationState): void {
  if (state.status !== 'running') return

  const { window: win, onContinue } = state
  if (win.isDestroyed()) {
    stopContinuation(state.ptyId)
    return
  }

  // Max iterations guard
  if (state.currentIteration >= state.maxIterations) {
    state.status = 'max_reached'
    states.delete(state.ptyId)
    state.hooks.onMaxReached?.({
      ptyId: state.ptyId,
      iterations: state.currentIteration,
      goal: state.goal,
    })
    win.webContents.send('continuation:maxReached', {
      ptyId: state.ptyId,
      iterations: state.currentIteration,
      goal: state.goal,
    })
    return
  }

  state.currentIteration++
  state.outputBuffer = ''  // Reset for next iteration
  state.hooks.onIteration?.({
    ptyId: state.ptyId,
    iteration: state.currentIteration,
    max: state.maxIterations,
  })
  win.webContents.send('continuation:iteration', {
    ptyId: state.ptyId,
    iteration: state.currentIteration,
    max: state.maxIterations,
  })
  onContinue(state.ptyId)
  scheduleCheck(state)
}

export function getContinuationState(ptyId: string): ContinuationState | undefined {
  return states.get(ptyId)
}

export function getAllStates(): Map<string, ContinuationState> {
  return states
}
