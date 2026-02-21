export type CLIType = 'claude' | 'gemini' | 'codex' | 'copilot' | 'qwen' | 'llm'

export const CLI_TYPES: readonly CLIType[] = ['claude', 'gemini', 'codex', 'copilot', 'qwen', 'llm'] as const

export function isValidCliType(value: unknown): value is CLIType {
  return typeof value === 'string' && (CLI_TYPES as readonly string[]).includes(value)
}

export type TaskCategory =
  | 'deep'        // Complex reasoning, architecture, planning -> claude opus
  | 'code'        // Code completion, quick edits -> codex
  | 'visual'      // Frontend, UI, CSS -> gemini
  | 'research'    // Docs, search, analysis -> claude sonnet
  | 'quick'       // Fast tasks -> claude haiku / codex
  | 'git'         // Git operations, PRs, commits -> copilot
  | 'local'       // Local LLM / private data -> llm

export interface RouteResult {
  cli: CLIType
  category: TaskCategory
  rationale: string
  confidence: number  // 0-1
}

function defaultCategoryForCli(cli: CLIType): TaskCategory {
  switch (cli) {
    case 'gemini': return 'visual'
    case 'codex': return 'code'
    case 'copilot': return 'git'
    case 'llm': return 'local'
    case 'qwen': return 'quick'
    case 'claude':
    default:
      return 'deep'
  }
}

function quoteForCurrentShell(raw: string): string {
  // Keep one-line prompts so command execution stays deterministic in shells
  const input = raw.replace(/\r?\n/g, ' ').trim()

  if (process.platform === 'win32') {
    // PowerShell-safe single-quoted string
    return `'${input.replace(/'/g, "''")}'`
  }

  // POSIX-safe single-quoted string
  return `'${input.replace(/'/g, `'\"'\"'`)}'`
}

/** Build a one-shot command that can be written repeatedly into a shell PTY. */
export function getOneShotCommand(cliType: CLIType, goal: string): string {
  const quotedGoal = quoteForCurrentShell(goal)

  switch (cliType) {
    case 'claude':
      return `claude -p ${quotedGoal}`
    case 'gemini':
      return `gemini -p ${quotedGoal}`
    case 'codex':
      return `codex -p ${quotedGoal}`
    case 'copilot':
      return `copilot ${quotedGoal}`
    case 'qwen':
      return `qwen ${quotedGoal}`
    case 'llm':
      return `ollama run llama3 ${quotedGoal}`
  }
}

// Weighted keyword scoring — each keyword has an individual weight so overlapping
// terms like "design" can contribute to multiple categories without first-match bias.
interface WeightedRule {
  keywords: Array<{ pattern: RegExp; weight: number }>
  cli: CLIType
  category: TaskCategory
  rationale: string
}

const RULES: WeightedRule[] = [
  {
    keywords: [
      { pattern: /\barchitect/i, weight: 1.0 },
      { pattern: /\bplan\b/i, weight: 0.8 },
      { pattern: /\breview\b/i, weight: 0.6 },
      { pattern: /\banalyze/i, weight: 0.8 },
      { pattern: /\bcomplex/i, weight: 0.7 },
      { pattern: /\brefactor/i, weight: 0.9 },
      { pattern: /\bwhy\b/i, weight: 0.5 },
      { pattern: /\bhow does\b/i, weight: 0.5 },
      { pattern: /\bdesign system/i, weight: 0.7 },
      { pattern: /\bsystem design/i, weight: 0.9 },
    ],
    cli: 'claude', category: 'deep',
    rationale: 'Claude for deep planning and architecture analysis',
  },
  {
    keywords: [
      { pattern: /\bfrontend/i, weight: 1.0 },
      { pattern: /\bui\b/i, weight: 0.9 },
      { pattern: /\bux\b/i, weight: 0.9 },
      { pattern: /\bcss\b/i, weight: 1.0 },
      { pattern: /\bhtml\b/i, weight: 0.7 },
      { pattern: /\bcomponent/i, weight: 0.8 },
      { pattern: /\breact\b/i, weight: 0.7 },
      { pattern: /\bvue\b/i, weight: 0.7 },
      { pattern: /\bangular\b/i, weight: 0.7 },
      { pattern: /\btailwind/i, weight: 0.9 },
      { pattern: /\bvisual/i, weight: 0.8 },
      { pattern: /\bdesign\b/i, weight: 0.4 },  // lower weight — shared with deep
      { pattern: /\blayout/i, weight: 0.9 },
      { pattern: /\bstyle/i, weight: 0.8 },
    ],
    cli: 'gemini', category: 'visual',
    rationale: 'Gemini for visual/frontend specialization',
  },
  {
    keywords: [
      { pattern: /\bcomplete/i, weight: 0.7 },
      { pattern: /\bautocomplete/i, weight: 0.9 },
      { pattern: /\bboilerplate/i, weight: 0.9 },
      { pattern: /\bscaffold/i, weight: 0.8 },
      { pattern: /\bgenerate\b/i, weight: 0.6 },
      { pattern: /\bsnippet/i, weight: 0.8 },
      { pattern: /\bquick fix/i, weight: 0.7 },
    ],
    cli: 'codex', category: 'code',
    rationale: 'Codex for rapid code generation and completion',
  },
  {
    keywords: [
      { pattern: /\bcommit/i, weight: 1.0 },
      { pattern: /\bpr\b/i, weight: 0.9 },
      { pattern: /\bpull request/i, weight: 1.0 },
      { pattern: /\bgithub/i, weight: 0.9 },
      { pattern: /\bbranch/i, weight: 0.8 },
      { pattern: /\bmerge/i, weight: 0.8 },
      { pattern: /\bgit\b/i, weight: 1.0 },
      { pattern: /\breview pr/i, weight: 1.0 },
    ],
    cli: 'copilot', category: 'git',
    rationale: 'Copilot for GitHub-integrated workflows',
  },
  {
    keywords: [
      { pattern: /\bprivate/i, weight: 0.9 },
      { pattern: /\blocal\b/i, weight: 0.8 },
      { pattern: /\boffline/i, weight: 1.0 },
      { pattern: /\bconfidential/i, weight: 1.0 },
      { pattern: /\bsensitive/i, weight: 0.9 },
      { pattern: /\bno cloud/i, weight: 1.0 },
    ],
    cli: 'llm', category: 'local',
    rationale: 'Local LLM for private/offline work',
  },
  {
    keywords: [
      { pattern: /\bdocs\b/i, weight: 0.8 },
      { pattern: /\bdocumentation/i, weight: 0.9 },
      { pattern: /\bsearch\b/i, weight: 0.5 },
      { pattern: /\blook up/i, weight: 0.7 },
      { pattern: /\bexplain/i, weight: 0.8 },
      { pattern: /\bwhat is/i, weight: 0.7 },
    ],
    cli: 'claude', category: 'research',
    rationale: 'Claude for research and documentation lookup',
  },
  {
    keywords: [
      { pattern: /\bfix bug/i, weight: 1.0 },
      { pattern: /\bdebug/i, weight: 1.0 },
      { pattern: /\berror\b/i, weight: 0.7 },
      { pattern: /\bcrash/i, weight: 0.9 },
      { pattern: /\btraceback/i, weight: 0.9 },
      { pattern: /\bexception/i, weight: 0.8 },
    ],
    cli: 'claude', category: 'deep',
    rationale: 'Claude for debugging with extended reasoning',
  },
  {
    keywords: [
      { pattern: /\btest\b/i, weight: 0.7 },
      { pattern: /\bunit test/i, weight: 1.0 },
      { pattern: /\bintegration test/i, weight: 1.0 },
      { pattern: /\bspec\b/i, weight: 0.6 },
      { pattern: /\bjest\b/i, weight: 0.9 },
      { pattern: /\bvitest\b/i, weight: 0.9 },
      { pattern: /\bpytest\b/i, weight: 0.9 },
    ],
    cli: 'codex', category: 'code',
    rationale: 'Codex for test generation',
  },
]

/** Route a natural-language task description to the best CLI + category */
export function routeTask(description: string, preferredCli?: CLIType): RouteResult {
  if (preferredCli) {
    return {
      cli: preferredCli,
      category: defaultCategoryForCli(preferredCli),
      rationale: `Manual override: using ${preferredCli}`,
      confidence: 1.0,
    }
  }

  let bestMatch: RouteResult | null = null
  let bestScore = 0

  for (const rule of RULES) {
    let totalWeight = 0
    let matchedWeight = 0

    for (const kw of rule.keywords) {
      totalWeight += kw.weight
      if (kw.pattern.test(description)) {
        matchedWeight += kw.weight
      }
    }

    if (matchedWeight > 0) {
      // Score is the weighted sum of matched keywords — higher absolute weight wins
      // Normalize by total possible weight for confidence display
      const confidence = matchedWeight / totalWeight
      if (matchedWeight > bestScore) {
        bestScore = matchedWeight
        bestMatch = {
          cli: rule.cli,
          category: rule.category,
          rationale: rule.rationale,
          confidence: Math.min(confidence, 1.0),
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

/** Build the CLI command string — always interactive mode.
 *  Goals are written to PTY stdin after spawn so the CLI stays alive
 *  and the continuation (loop) engine can send "continue" later. */
function buildCliString(cliType: CLIType): string {
  switch (cliType) {
    case 'claude':  return 'claude'
    case 'gemini':  return 'gemini'
    case 'codex':   return 'codex'
    case 'copilot': return 'copilot'
    case 'qwen':    return 'qwen'
    case 'llm':     return 'ollama run llama3'
  }
}

/** Get the shell + command to spawn for a given CLI type.
 *  On Windows: uses cmd.exe /c which inherits the full user PATH.
 *  On macOS: uses zsh -lic.
 *  On Linux: uses bash -lic.
 *  Always spawns in interactive mode — goals are written to stdin after spawn. */
export function getCliCommand(
  cliType: CLIType,
  workingDir: string,
): { cmd: string; args: string[]; cwd: string } {
  const cliCmd = buildCliString(cliType)

  if (process.platform === 'win32') {
    return {
      cmd: 'cmd.exe',
      args: ['/c', cliCmd],
      cwd: workingDir,
    }
  }

  if (process.platform === 'darwin') {
    return {
      cmd: 'zsh',
      args: ['-lic', cliCmd],
      cwd: workingDir,
    }
  }

  // Linux
  return {
    cmd: 'bash',
    args: ['-lic', cliCmd],
    cwd: workingDir,
  }
}
