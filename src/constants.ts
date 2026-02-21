/** Agent CLI brand colors — single source of truth for all components */
export const CLI_COLORS: Record<string, string> = {
  claude: '#60a5fa',
  gemini: '#a855f7',
  codex: '#22c55e',
  copilot: '#f97316',
  qwen: '#ec4899',
  llm: '#10b981',
}

export const CLI_OPTIONS = [
  { id: 'claude', label: 'Claude', color: '#60a5fa' },
  { id: 'gemini', label: 'Gemini', color: '#a855f7' },
  { id: 'codex', label: 'Codex', color: '#22c55e' },
  { id: 'copilot', label: 'Copilot', color: '#f97316' },
  { id: 'qwen', label: 'Qwen', color: '#ec4899' },
  { id: 'llm', label: 'Local LLM', color: '#10b981' },
] as const

export const STATUS_COLORS: Record<string, string> = {
  spawning: '#f97316',
  running: '#22c55e',
  idle: '#8b949e',
  dead: '#484f58',
}
