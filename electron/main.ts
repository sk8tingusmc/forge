import { app, BrowserWindow, ipcMain, Notification, dialog, shell, session } from 'electron'
import * as nodePty from '@lydell/node-pty'
import { spawn as spawnChild } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as crypto from 'crypto'
import { initDatabase, upsertWorkspace, listWorkspaces, getWorkspaceById,
  storeMemory, searchMemory, listMemories, deleteMemory,
  createAgentSession, endAgentSession, incrementSessionIteration, listActiveSessions,
  saveContinuationState, updateContinuationIteration, deleteContinuationState,
} from './database/db'
import { routeTask, getCliCommand, getOneShotCommand, isValidCliType } from './agents/router'
import type { CLIType } from './agents/router'
import {
  startContinuation, stopContinuation, onPtyData as continuationOnData,
  getContinuationState, ONE_SHOT_DONE_MARKER,
} from './agents/continuation'

// -- Types --------------------------------------------------------------------

interface SkillDef {
  name: string
  description: string
  path: string
  content: string
}

interface PtySession {
  pty: nodePty.IPty
  ptyId: string
  workspaceId: string
  workspacePath: string
  cliType: CLIType
  sessionId: string
  oneShotCommand?: string
}

// -- State --------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null
const ptySessions = new Map<string, PtySession>()
const idleNotifTimers = new Map<string, NodeJS.Timeout>()
const sessionHadActivity = new Set<string>()

const IDLE_NOTIFY_MS = 5_000
const ENTER_KEY = '\r'

// -- Validation helpers -------------------------------------------------------

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
}

function assertOptionalString(value: unknown, name: string): asserts value is string | undefined {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new Error(`${name} must be a string or undefined`)
  }
}

function assertOptionalBoolean(value: unknown, name: string): asserts value is boolean | undefined {
  if (value !== undefined && value !== null && typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean or undefined`)
  }
}

function assertCliType(value: unknown): asserts value is CLIType {
  if (!isValidCliType(value)) throw new Error(`Invalid CLI type: ${String(value)}`)
}

function assertDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Directory not found: ${dirPath}`)
  }
}

function getOneShotRunnerCommand(workingDir: string): { cmd: string; args: string[]; cwd: string } {
  if (process.platform === 'win32') {
    return {
      cmd: 'powershell.exe',
      // Script runner mode reads commands from stdin with no interactive prompt.
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
      cwd: workingDir,
    }
  }

  const shellPath = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return {
    cmd: shellPath,
    // -s reads commands from stdin as a script (no prompt rendering)
    args: ['-s'],
    cwd: workingDir,
  }
}

function getPersistentInteractiveShellCommand(workingDir: string): { cmd: string; args: string[]; cwd: string } {
  if (process.platform === 'win32') {
    return {
      cmd: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile'],
      cwd: workingDir,
    }
  }

  const shellPath = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return {
    cmd: shellPath,
    args: ['-i'],
    cwd: workingDir,
  }
}

function getClaudeResumeCommand(sessionId: string, workingDir: string): { cmd: string; args: string[]; cwd: string } {
  if (process.platform === 'win32') {
    return {
      cmd: 'cmd.exe',
      args: ['/c', 'claude', '--resume', sessionId],
      cwd: workingDir,
    }
  }
  return {
    cmd: process.platform === 'darwin' ? 'zsh' : 'bash',
    args: ['-lic', `claude --resume ${sessionId}`],
    cwd: workingDir,
  }
}

function stripOneShotMarker(output: string): string {
  const markerRegex = new RegExp(`^.*${ONE_SHOT_DONE_MARKER}.*(?:\\r?\\n)?`, 'gm')
  return output.replace(markerRegex, '')
}

function copyFileIfPresent(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath)) return
  const targetDir = path.dirname(targetPath)
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }
  fs.copyFileSync(sourcePath, targetPath)
}

function isValidJsonText(content: string): boolean {
  try {
    JSON.parse(content)
    return true
  } catch {
    return false
  }
}

function ensureHealthyClaudeConfig(homeDir: string): void {
  const configPath = path.join(homeDir, '.claude.json')
  if (!fs.existsSync(configPath)) return

  let rawConfig = ''
  try {
    rawConfig = fs.readFileSync(configPath, 'utf8')
  } catch {
    return
  }
  if (isValidJsonText(rawConfig)) return

  const backupDir = path.join(homeDir, '.claude', 'backups')
  if (!fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) return

  let backupFiles: string[] = []
  try {
    backupFiles = fs.readdirSync(backupDir)
      .filter((name) => name.startsWith('.claude.json.backup.'))
      .map((name) => path.join(backupDir, name))
      .sort((a, b) => {
        const bMtime = fs.statSync(b).mtimeMs
        const aMtime = fs.statSync(a).mtimeMs
        return bMtime - aMtime
      })
  } catch {
    return
  }

  for (const backupPath of backupFiles) {
    try {
      const backupContent = fs.readFileSync(backupPath, 'utf8')
      if (!isValidJsonText(backupContent)) continue
      fs.copyFileSync(backupPath, configPath)
      return
    } catch {
      continue
    }
  }
}

function createIsolatedClaudeHome(jobId: string, runIndex: number): { homeDir: string; cleanup: () => void } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `forge-claude-${jobId}-${runIndex + 1}-`))
  const homeDir = path.join(tempRoot, 'home')
  fs.mkdirSync(homeDir, { recursive: true })

  if (process.platform === 'win32') {
    fs.mkdirSync(path.join(homeDir, 'AppData', 'Roaming'), { recursive: true })
    fs.mkdirSync(path.join(homeDir, 'AppData', 'Local'), { recursive: true })
  }

  const userHome = os.homedir()
  copyFileIfPresent(path.join(userHome, '.claude.json'), path.join(homeDir, '.claude.json'))

  const sourceClaudeDir = path.join(userHome, '.claude')
  const targetClaudeDir = path.join(homeDir, '.claude')
  fs.mkdirSync(targetClaudeDir, { recursive: true })

  // Keep hidden fan-out runs authenticated without touching the user's live files.
  copyFileIfPresent(path.join(sourceClaudeDir, '.credentials.json'), path.join(targetClaudeDir, '.credentials.json'))
  copyFileIfPresent(path.join(sourceClaudeDir, 'settings.json'), path.join(targetClaudeDir, 'settings.json'))
  copyFileIfPresent(path.join(sourceClaudeDir, 'settings.local.json'), path.join(targetClaudeDir, 'settings.local.json'))
  copyFileIfPresent(path.join(sourceClaudeDir, 'CLAUDE.md'), path.join(targetClaudeDir, 'CLAUDE.md'))

  return {
    homeDir,
    cleanup: () => {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true })
      } catch {
        // Best-effort temp cleanup.
      }
    },
  }
}

function applyIsolatedHomeToEnv(env: NodeJS.ProcessEnv, isolatedHomeDir: string): void {
  env.HOME = isolatedHomeDir

  if (process.platform === 'win32') {
    const normalized = path.resolve(isolatedHomeDir)
    env.USERPROFILE = normalized

    const parsed = path.parse(normalized)
    const drive = parsed.root.replace(/[\\\/]+$/, '')
    const tail = normalized.slice(drive.length).replace(/\//g, '\\')
    env.HOMEDRIVE = drive
    env.HOMEPATH = tail.startsWith('\\') ? tail : `\\${tail}`
    env.APPDATA = path.join(normalized, 'AppData', 'Roaming')
    env.LOCALAPPDATA = path.join(normalized, 'AppData', 'Local')
  }
}

function sanitizeHiddenClaudeOutput(output: string): string {
  const patterns = [
    /^Claude configuration file at .* is corrupted:.*(?:\r?\n)?/gim,
    /^The corrupted file has been backed up to:.*(?:\r?\n)?/gim,
    /^A backup file exists at:.*(?:\r?\n)?/gim,
    /^You can manually restore it by running:.*(?:\r?\n)?/gim,
  ]

  let cleaned = output
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, '')
  }

  return cleaned.replace(/\n{3,}/g, '\n\n').trim()
}

function appendShellData(ptyId: string, data: string): void {
  if (!data) return
  mainWindow?.webContents.send('shell:data', ptyId, data)
}

async function runHiddenClaudeOnce(
  goal: string,
  cwd: string,
  options?: { sessionId?: string; isolatedHomeDir?: string; noSessionPersistence?: boolean }
): Promise<string> {
  return await new Promise((resolve) => {
    const childEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    if (options?.isolatedHomeDir) {
      applyIsolatedHomeToEnv(childEnv, options.isolatedHomeDir)
    }
    // Always pipe prompt via stdin to avoid OS command-line length limits
    // (Windows can throw ENAMETOOLONG for large synthesized prompts).
    const args: string[] = ['-p']
    if (options?.noSessionPersistence) {
      args.push('--no-session-persistence')
    }
    if (options?.sessionId) {
      args.push('--session-id', options.sessionId)
    }
    let child: ReturnType<typeof spawnChild>
    try {
      child = spawnChild('claude', args, {
        cwd,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      resolve(`(runner error: ${msg})`)
      return
    }

    // Send full prompt payload through stdin so argument size stays small.
    try {
      child.stdin?.end(goal)
    } catch {
      // If stdin is already closed, child error/close handlers will surface details.
    }

    let output = ''
    let finished = false
    const timeout = setTimeout(() => {
      if (finished) return
      finished = true
      try { child.kill() } catch {}
      resolve('(timed out)')
    }, 600_000)

    child.stdout?.on('data', (d: Buffer | string) => { output += d.toString() })
    child.stderr?.on('data', (d: Buffer | string) => { output += d.toString() })
    child.on('error', (err: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      resolve(`(runner error: ${err.message})`)
    })
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      const trimmed = output.trim()
      if (trimmed) {
        const cleaned = sanitizeHiddenClaudeOutput(trimmed)
        resolve(cleaned || '(empty)')
        return
      }
      if (signal) resolve(`(terminated: ${signal})`)
      else resolve(code === 0 ? '(empty)' : `(exit code ${code ?? 'unknown'})`)
    })
  })
}

// -- Sanitized environment for PTY child processes ----------------------------

const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TERM', 'COLORTERM', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR',
  'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
  'WSLENV', 'WSL_DISTRO_NAME', 'WSL_INTEROP',
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES',
  'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
  'COMSPEC', 'PSModulePath',
]

function getSanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key]) {
      env[key] = process.env[key]!
    }
  }
  env['TERM'] = 'xterm-256color'
  env['COLORTERM'] = 'truecolor'
  env['LANG'] = env['LANG'] || 'en_US.UTF-8'
  return env
}

// -- Window -------------------------------------------------------------------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false is required because the preload script uses node-pty
      // via IPC. The contextBridge is the sole renderer-accessible interface.
      sandbox: false,
    },
  })

  const isDev = !app.isPackaged

  // Set CSP via session headers — tight for production, relaxed for dev
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self' ws://localhost:5175 http://localhost:5175"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:;"
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5175')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    for (const [ptyId] of ptySessions) {
      cleanupPtySession(ptyId)
    }
    mainWindow = null
  })
}

// -- PTY management -----------------------------------------------------------

function cleanupPtySession(ptyId: string): void {
  const ptySession = ptySessions.get(ptyId)
  if (!ptySession) return  // Already cleaned up — idempotent guard

  // Remove from map first to prevent re-entry from concurrent calls
  ptySessions.delete(ptyId)

  try { ptySession.pty.kill() } catch { /* process may already be dead */ }
  endAgentSession(ptySession.sessionId)
  deleteContinuationState(ptyId)

  const existingTimer = idleNotifTimers.get(ptyId)
  if (existingTimer) clearTimeout(existingTimer)
  idleNotifTimers.delete(ptyId)
  sessionHadActivity.delete(ptyId)
  stopContinuation(ptyId)
}

// -- Skills loader ------------------------------------------------------------

function loadSkillsForWorkspace(workspacePath: string): SkillDef[] {
  const searchPaths = [
    path.join(workspacePath, '.forge', 'skills'),
    path.join(workspacePath, '.claude', 'skills'),
    path.join(workspacePath, '.opencode', 'skills'),
    path.join(os.homedir(), '.forge', 'skills'),
  ]
  const skills: SkillDef[] = []
  for (const dir of searchPaths) {
    if (!fs.existsSync(dir)) continue
    let entries: string[]
    try { entries = fs.readdirSync(dir) } catch { continue }
    for (const entry of entries) {
      const skillMd = path.join(dir, entry, 'SKILL.md')
      if (!fs.existsSync(skillMd)) continue
      try {
        const content = fs.readFileSync(skillMd, 'utf8')
        const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        const metadata = frontmatter?.[1] ?? ''
        const nameMatch = metadata.match(/^name:\s*(.+)$/mi)
        const descMatch = metadata.match(/^description:\s*(.+)$/mi)
        skills.push({
          name: nameMatch?.[1]?.trim() ?? entry,
          description: descMatch?.[1]?.trim() ?? '',
          path: skillMd,
          content,
        })
      } catch { /* skip unreadable skill files */ }
    }
  }
  return skills
}

// -- Agents.md loader ---------------------------------------------------------

function loadAgentsMd(workspacePath: string): string | null {
  const candidates = [
    path.join(workspacePath, 'AGENTS.md'),
    path.join(workspacePath, 'CLAUDE.md'),
    path.join(workspacePath, '.forge', 'AGENTS.md'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return fs.readFileSync(p, 'utf8') } catch { /* skip */ }
    }
  }
  return null
}

// -- IPC Handlers -------------------------------------------------------------

function setupIPC(): void {
  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())

  // Open external links — validate URL scheme
  ipcMain.handle('shell:openExternal', (_e, url: unknown) => {
    assertString(url, 'url')
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Refusing to open non-HTTP URL: ${url}`)
    }
    return shell.openExternal(url)
  })

  // Open a directory in the system file explorer
  ipcMain.handle('shell:openPath', (_e, dirPath: unknown) => {
    assertString(dirPath, 'dirPath')
    // Create the directory if it doesn't exist
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
    return shell.openPath(dirPath)
  })

  // -- Workspace APIs ---------------------------------------------------------

  ipcMain.handle('workspace:open', async (_e, dirPath: unknown) => {
    assertString(dirPath, 'dirPath')
    assertDirectoryExists(dirPath)

    const id = crypto.createHash('sha256').update(dirPath).digest('hex').slice(0, 16)
    const name = path.basename(dirPath)
    upsertWorkspace(id, dirPath, name)
    const skills = loadSkillsForWorkspace(dirPath)
    const agentsMd = loadAgentsMd(dirPath)
    return { id, path: dirPath, name, skills, agentsMd }
  })

  ipcMain.handle('workspace:list', () => listWorkspaces())

  ipcMain.handle('workspace:get', (_e, id: unknown) => {
    assertString(id, 'id')
    return getWorkspaceById(id)
  })

  ipcMain.handle('workspace:pickDirectory', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Open Workspace',
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('workspace:getSkills', (_e, workspacePath: unknown) => {
    assertString(workspacePath, 'workspacePath')
    assertDirectoryExists(workspacePath)
    return loadSkillsForWorkspace(workspacePath)
  })

  ipcMain.handle('workspace:getAgentsMd', (_e, workspacePath: unknown) => {
    assertString(workspacePath, 'workspacePath')
    assertDirectoryExists(workspacePath)
    return loadAgentsMd(workspacePath)
  })

  ipcMain.handle('workspace:activeSessions', (_e, workspaceId: unknown) => {
    assertString(workspaceId, 'workspaceId')
    return listActiveSessions(workspaceId)
  })

  // -- Memory APIs ------------------------------------------------------------

  ipcMain.handle('memory:store', (_e, workspaceId: unknown, key: unknown, content: unknown, category?: unknown) => {
    assertString(workspaceId, 'workspaceId')
    assertString(key, 'key')
    assertString(content, 'content')
    assertOptionalString(category, 'category')
    storeMemory(workspaceId, key, content, category as string | undefined)
    return { ok: true }
  })

  ipcMain.handle('memory:search', (_e, workspaceId: unknown, query: unknown) => {
    assertString(workspaceId, 'workspaceId')
    assertString(query, 'query')
    return searchMemory(workspaceId, query)
  })

  ipcMain.handle('memory:list', (_e, workspaceId: unknown, category?: unknown) => {
    assertString(workspaceId, 'workspaceId')
    assertOptionalString(category, 'category')
    return listMemories(workspaceId, category as string | undefined)
  })

  ipcMain.handle('memory:delete', (_e, workspaceId: unknown, key: unknown) => {
    assertString(workspaceId, 'workspaceId')
    assertString(key, 'key')
    deleteMemory(workspaceId, key)
    return { ok: true }
  })

  // -- Agent routing ----------------------------------------------------------

  ipcMain.handle('agent:route', (_e, description: unknown, preferredCli?: unknown) => {
    assertString(description, 'description')
    if (preferredCli !== undefined && preferredCli !== null) {
      assertCliType(preferredCli)
    }
    return routeTask(description, preferredCli as CLIType | undefined)
  })

  // -- PTY / Shell APIs -------------------------------------------------------

  ipcMain.handle(
    'shell:spawn',
    (
      _e,
      cliType: unknown,
      workspacePath: unknown,
      workspaceId: unknown,
      goal?: unknown,
      oneShotLoop?: unknown,
      shellSession?: unknown,
      resumeSessionId?: unknown
    ) => {
    assertCliType(cliType)
    assertString(workspacePath, 'workspacePath')
    assertString(workspaceId, 'workspaceId')
    assertOptionalString(goal, 'goal')
    assertOptionalBoolean(oneShotLoop, 'oneShotLoop')
    assertOptionalBoolean(shellSession, 'shellSession')
    assertOptionalString(resumeSessionId, 'resumeSessionId')
    assertDirectoryExists(workspacePath)

    const ptyId = `pty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const goalStr = (typeof goal === 'string' && goal.trim()) ? goal.trim() : undefined
    const useShellSession = Boolean(shellSession)
    const useResumeSession = Boolean(cliType === 'claude' && typeof resumeSessionId === 'string' && resumeSessionId.trim())
    const useOneShotLoop = Boolean(oneShotLoop && goalStr && cliType === 'claude')
    const oneShotCommand = useOneShotLoop && goalStr
      ? `${getOneShotCommand(cliType, goalStr)}; echo ${ONE_SHOT_DONE_MARKER}`
      : undefined
    const spawnSpec = useOneShotLoop
      ? getOneShotRunnerCommand(workspacePath)
      : useShellSession
        ? getPersistentInteractiveShellCommand(workspacePath)
        : useResumeSession
          ? getClaudeResumeCommand((resumeSessionId as string).trim(), workspacePath)
          : getCliCommand(cliType, workspacePath)

    let ptyProcess: nodePty.IPty
    try {
      ptyProcess = nodePty.spawn(spawnSpec.cmd, spawnSpec.args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: spawnSpec.cwd,
        env: getSanitizedEnv(),
      })
    } catch (err: unknown) {
      return { error: String(err) }
    }

    createAgentSession(sessionId, workspaceId, cliType, goalStr)

    const ptySession: PtySession = {
      pty: ptyProcess,
      ptyId,
      workspaceId,
      workspacePath,
      cliType,
      sessionId,
      oneShotCommand,
    }
    ptySessions.set(ptyId, ptySession)

    ptyProcess.onData((data: string) => {
      sessionHadActivity.add(ptyId)

      // Reset idle notification timer
      const existing = idleNotifTimers.get(ptyId)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        idleNotifTimers.delete(ptyId)
        if (!mainWindow?.isFocused() && sessionHadActivity.has(ptyId)) {
          new Notification({
            title: 'Forge - Agent Idle',
            body: `${cliType} is waiting for input`,
          }).show()
        }
      }, IDLE_NOTIFY_MS)
      idleNotifTimers.set(ptyId, timer)

      // Feed into continuation engine
      continuationOnData(ptyId, data)

      const renderedData = ptySession.oneShotCommand ? stripOneShotMarker(data) : data
      if (renderedData) {
        mainWindow?.webContents.send('shell:data', ptyId, renderedData)
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      // Capture activity flag BEFORE cleanup deletes it
      const hadActivity = sessionHadActivity.has(ptyId)

      cleanupPtySession(ptyId)

      if (!mainWindow?.isFocused() && hadActivity) {
        new Notification({
          title: 'Forge - Agent Exited',
          body: `${cliType} exited (code ${exitCode})`,
        }).show()
      }
      mainWindow?.webContents.send('shell:exit', ptyId, exitCode)
    })

    // If a goal was provided, write it to PTY stdin after the CLI starts up.
    // Interactive mode keeps the CLI alive so the continuation loop can work.
    if (goalStr && !useOneShotLoop && !useShellSession && !useResumeSession) {
      setTimeout(() => {
        try { ptyProcess.write(goalStr + ENTER_KEY) } catch { /* pty may have exited */ }
      }, 1500)
    }

    return { ptyId, sessionId }
  })

  ipcMain.on('shell:write', (_e, ptyId: unknown, data: unknown) => {
    if (typeof ptyId !== 'string' || typeof data !== 'string') return
    ptySessions.get(ptyId)?.pty.write(data)
  })

  ipcMain.on('shell:resize', (_e, ptyId: unknown, cols: unknown, rows: unknown) => {
    if (typeof ptyId !== 'string' || typeof cols !== 'number' || typeof rows !== 'number') return
    if (cols < 1 || cols > 500 || rows < 1 || rows > 200) return
    ptySessions.get(ptyId)?.pty.resize(cols, rows)
  })

  ipcMain.handle('shell:kill', (_e, ptyId: unknown) => {
    assertString(ptyId, 'ptyId')
    cleanupPtySession(ptyId)
    return { ok: true }
  })

  ipcMain.handle('shell:list', () => {
    return Array.from(ptySessions.entries()).map(([id, s]) => ({
      ptyId: id, workspaceId: s.workspaceId, cliType: s.cliType,
    }))
  })

  // -- Continuation engine APIs -----------------------------------------------

  ipcMain.handle('continuation:start', (_e, ptyId: unknown, workspaceId: unknown, goal: unknown, maxIterations?: unknown) => {
    assertString(ptyId, 'ptyId')
    assertString(workspaceId, 'workspaceId')
    assertString(goal, 'goal')
    if (!mainWindow) return { error: 'No window' }

    const max = typeof maxIterations === 'number' && isFinite(maxIterations) && maxIterations > 0
      ? Math.min(maxIterations, 100)
      : 20

    const session = ptySessions.get(ptyId)
    const isOneShotLoop = Boolean(session?.oneShotCommand)

    saveContinuationState(ptyId, workspaceId, goal, max, 0)
    startContinuation(
      ptyId, goal, max,
      (id) => {
        const s = ptySessions.get(id)
        if (!s) return
        const line = s.oneShotCommand ? `${s.oneShotCommand}${ENTER_KEY}` : `continue${ENTER_KEY}`
        s.pty.write(line)
      },
      mainWindow,
      {
        onIteration: ({ ptyId: id, iteration }) => {
          updateContinuationIteration(id, iteration)
          const session = ptySessions.get(id)
          if (session) incrementSessionIteration(session.sessionId)
        },
        onDone: ({ ptyId: id }) => {
          deleteContinuationState(id)
        },
        onMaxReached: ({ ptyId: id }) => {
          deleteContinuationState(id)
        },
      },
      {
        kickOff: isOneShotLoop,
        quietDelayMs: isOneShotLoop ? 1_000 : undefined,
      }
    )
    return { ok: true }
  })

  ipcMain.handle('continuation:stop', (_e, ptyId: unknown) => {
    assertString(ptyId, 'ptyId')
    stopContinuation(ptyId)
    deleteContinuationState(ptyId)
    return { ok: true }
  })

  ipcMain.handle('continuation:state', (_e, ptyId: unknown) => {
    assertString(ptyId, 'ptyId')
    const s = getContinuationState(ptyId)
    if (!s) return null
    return { ptyId: s.ptyId, goal: s.goal, iteration: s.currentIteration, max: s.maxIterations, status: s.status }
  })

  // -- Ensemble synthesis -----------------------------------------------------

  ipcMain.handle('ensemble:synthesis', async (_e, workspaceId: unknown, workspacePath: unknown, goal: unknown, n: unknown) => {
    assertString(workspaceId, 'workspaceId')
    assertString(workspacePath, 'workspacePath')
    assertString(goal, 'goal')
    assertDirectoryExists(workspacePath)
    ensureHealthyClaudeConfig(os.homedir())

    const count = (typeof n === 'number' && isFinite(n))
      ? Math.max(1, Math.min(12, Math.floor(n)))
      : 5
    const jobId = `synth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    mainWindow?.webContents.send('ensemble:progress', { jobId, workspaceId, goal, completed: 0, total: count })

    const results = new Array<string>(count)
    let completed = 0
    const runs = Array.from({ length: count }, (_, index) =>
      (async () => {
        const isolatedHome = createIsolatedClaudeHome(jobId, index)
        try {
          const text = await runHiddenClaudeOnce(goal, workspacePath, {
            isolatedHomeDir: isolatedHome.homeDir,
            noSessionPersistence: true,
          })
          results[index] = `=== Claude ${index + 1}/${count} ===\n${text}`
          completed += 1
          mainWindow?.webContents.send('ensemble:progress', { jobId, workspaceId, goal, completed, total: count })
        } finally {
          isolatedHome.cleanup()
        }
      })()
    )
    await Promise.all(runs)
    const combined = results.join('\n\n')

    const synthPrompt =
      `You are a world-class synthesizer. Here are ${count} independent answers to the same task:\n\n` +
      `${combined}\n\n` +
      'Produce one final, concise, high-quality answer that is better than any individual response.'

    const finalSessionId = crypto.randomUUID()
    await runHiddenClaudeOnce(synthPrompt, workspacePath, { sessionId: finalSessionId })
    mainWindow?.webContents.send('ensemble:done', {
      jobId,
      workspaceId,
      goal,
      sessionId: finalSessionId,
      total: count,
    })
    return { ok: true, count, sessionId: finalSessionId, jobId }
  })
}

// -- App lifecycle ------------------------------------------------------------

// Single instance lock — must be checked before app.whenReady()
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    initDatabase()
    setupIPC()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
