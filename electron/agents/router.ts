export type CLIType = 'claude' | 'gemini' | 'codex' | 'copilot' | 'qwen' | 'llm'

export type TaskCategory =
  | 'deep'        // Complex reasoning, architecture, planning → claude opus
  | 'code'        // Code completion, quick edits → codex
  | 'visual'      // Frontend, UI, CSS → gemini
  | 'research'    // Docs, search, analysis → claude sonnet
  | 'quick'       // Fast tasks → claude haiku / codex
  | 'git'         // Git operations, PRs, commits → copilot
  | 'local'       // Local LLM / private data → llm

export interface RouteResult {
  cli: CLIType
  category: TaskCategory
  rationale: string
  confidence: number  // 0–1
}

interface Rule {
  patterns: RegExp[]
  cli: CLIType
  category: TaskCategory
  rationale: string
}

const RULES: Rule[] = [
  {
    patterns: [/\b(architect|design|plan|review|analyze|complex|refactor|why|how does)\b/i],
    cli: 'claude', category: 'deep',
    rationale: 'Claude for deep planning and architecture analysis',
  },
  {
    patterns: [/\b(frontend|ui|ux|css|html|component|react|vue|angular|tailwind|visual|design|layout|style)\b/i],
    cli: 'gemini', category: 'visual',
    rationale: 'Gemini for visual/frontend specialization',
  },
  {
    patterns: [/\b(complete|autocomplete|boilerplate|scaffold|generate|snippet|quick fix)\b/i],
    cli: 'codex', category: 'code',
    rationale: 'Codex for rapid code generation and completion',
  },
  {
    patterns: [/\b(commit|pr|pull request|github|branch|merge|git|review pr)\b/i],
    cli: 'copilot', category: 'git',
    rationale: 'Copilot for GitHub-integrated workflows',
  },
  {
    patterns: [/\b(private|local|offline|confidential|sensitive|no cloud)\b/i],
    cli: 'llm', category: 'local',
    rationale: 'Local LLM for private/offline work',
  },
  {
    patterns: [/\b(docs|documentation|search|find|look up|explain|what is)\b/i],
    cli: 'claude', category: 'research',
    rationale: 'Claude for research and documentation lookup',
  },
  {
    patterns: [/\b(fix bug|debug|error|crash|traceback|exception)\b/i],
    cli: 'claude', category: 'deep',
    rationale: 'Claude for debugging with extended reasoning',
  },
  {
    patterns: [/\b(test|unit test|integration test|spec|jest|vitest|pytest)\b/i],
    cli: 'codex', category: 'code',
    rationale: 'Codex for test generation',
  },
]

/** Route a natural-language task description to the best CLI + category */
export function routeTask(description: string, preferredCli?: CLIType): RouteResult {
  if (preferredCli) {
    return {
      cli: preferredCli,
      category: 'deep',
      rationale: `Manual override: using ${preferredCli}`,
      confidence: 1.0,
    }
  }

  let bestMatch: RouteResult | null = null
  let bestScore = 0

  for (const rule of RULES) {
    let matches = 0
    for (const pattern of rule.patterns) {
      if (pattern.test(description)) matches++
    }
    if (matches > 0) {
      const score = matches / rule.patterns.length
      if (score > bestScore) {
        bestScore = score
        bestMatch = {
          cli: rule.cli,
          category: rule.category,
          rationale: rule.rationale,
          confidence: score,
        }
      }
    }
  }

  return bestMatch ?? {
    cli: 'claude',
    category: 'deep',
    rationale: 'Claude as default general-purpose agent',
    confidence: 0.5,
  }
}

/** Get the WSL command args for a given CLI type */
export function getCliCommand(cliType: CLIType, workingDir: string): { cmd: string; args: string[] } {
  // All CLIs run inside WSL Ubuntu
  const wslDir = workingDir.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/')

  const cliMap: Record<CLIType, string> = {
    claude: 'claude',
    gemini: 'gemini',
    codex: 'codex',
    copilot: 'gh copilot',
    qwen: 'qwen-code',
    llm: 'llm',
  }

  return {
    cmd: 'wsl.exe',
    args: ['-d', 'Ubuntu', '--', 'bash', '-c', `cd "${wslDir}" && ${cliMap[cliType]}`],
  }
}
