import { app, BrowserWindow, ipcMain, Notification, dialog, shell } from 'electron'
import * as nodePty from '@lydell/node-pty'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as crypto from 'crypto'
import { initDatabase, upsertWorkspace, listWorkspaces, getWorkspaceById,
  storeMemory, searchMemory, listMemories, deleteMemory,
  createAgentSession, endAgentSession, incrementSessionIteration, listActiveSessions,
} from './database/db'
import { routeTask, getCliCommand } from './agents/router'
import type { CLIType } from './agents/router'
import {
  startContinuation, stopContinuation, onPtyData as continuationOnData,
  getContinuationState,
} from './agents/continuation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PtySession {
  pty: nodePty.IPty
  ptyId: string
  workspaceId: string
  cliType: CLIType
  sessionId: string
}

// ── State ─────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
const ptySessions = new Map<string, PtySession>()
const idleNotifTimers = new Map<string, NodeJS.Timeout>()
const sessionHadActivity = new Set<string>()

const IDLE_NOTIFY_MS = 5_000

// ── Window ────────────────────────────────────────────────────────────────────

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
      sandbox: false,
    },
  })

  const isDev = !app.isPackaged
  if (isDev) {
    mainWindow.loadURL('http://localhost:5174')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    // Clean up all PTY sessions
    for (const [ptyId, session] of ptySessions) {
      cleanupPtySession(ptyId)
    }
    mainWindow = null
  })
}

// ── PTY management ────────────────────────────────────────────────────────────

function cleanupPtySession(ptyId: string): void {
  const session = ptySessions.get(ptyId)
  if (session) {
    try { session.pty.kill() } catch {}
    endAgentSession(session.sessionId)
    ptySessions.delete(ptyId)
  }
  const existingTimer = idleNotifTimers.get(ptyId)
  if (existingTimer) clearTimeout(existingTimer)
  idleNotifTimers.delete(ptyId)
  sessionHadActivity.delete(ptyId)
  stopContinuation(ptyId)
}

// ── Skills loader ─────────────────────────────────────────────────────────────

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
    try {
      for (const entry of fs.readdirSync(dir)) {
        const skillMd = path.join(dir, entry, 'SKILL.md')
        if (fs.existsSync(skillMd)) {
          const content = fs.readFileSync(skillMd, 'utf8')
          const nameMatch = content.match(/^name:\s*(.+)$/m)
          const descMatch = content.match(/^description:\s*(.+)$/m)
          skills.push({
            name: nameMatch?.[1]?.trim() ?? entry,
            description: descMatch?.[1]?.trim() ?? '',
            path: skillMd,
            content,
          })
        }
      }
    } catch {}
  }
  return skills
}

interface SkillDef {
  name: string
  description: string
  path: string
  content: string
}

// ── Agents.md loader ──────────────────────────────────────────────────────────

function loadAgentsMd(workspacePath: string): string | null {
  const candidates = [
    path.join(workspacePath, 'AGENTS.md'),
    path.join(workspacePath, 'CLAUDE.md'),
    path.join(workspacePath, '.forge', 'AGENTS.md'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return fs.readFileSync(p, 'utf8') } catch {}
    }
  }
  return null
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

function setupIPC(): void {
  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())

  // Open external links
  ipcMain.handle('shell:openExternal', (_e, url: string) => shell.openExternal(url))

  // ── Workspace APIs ──────────────────────────────────────────────────────────

  ipcMain.handle('workspace:open', async (_e, dirPath: string) => {
    if (!fs.existsSync(dirPath)) return { error: 'Directory not found' }
    const id = crypto.createHash('sha256').update(dirPath).digest('hex').slice(0, 16)
    const name = path.basename(dirPath)
    upsertWorkspace(id, dirPath, name)
    const skills = loadSkillsForWorkspace(dirPath)
    const agentsMd = loadAgentsMd(dirPath)
    return { id, path: dirPath, name, skills, agentsMd }
  })

  ipcMain.handle('workspace:list', () => listWorkspaces())

  ipcMain.handle('workspace:get', (_e, id: string) => getWorkspaceById(id))

  ipcMain.handle('workspace:pickDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Open Workspace',
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('workspace:getSkills', (_e, workspacePath: string) => {
    return loadSkillsForWorkspace(workspacePath)
  })

  ipcMain.handle('workspace:getAgentsMd', (_e, workspacePath: string) => {
    return loadAgentsMd(workspacePath)
  })

  ipcMain.handle('workspace:activeSessions', (_e, workspaceId: string) => {
    return listActiveSessions(workspaceId)
  })

  // ── Memory APIs ─────────────────────────────────────────────────────────────

  ipcMain.handle('memory:store', (_e, workspaceId: string, key: string, content: string, category?: string) => {
    storeMemory(workspaceId, key, content, category)
    return { ok: true }
  })

  ipcMain.handle('memory:search', (_e, workspaceId: string, query: string) => {
    return searchMemory(workspaceId, query)
  })

  ipcMain.handle('memory:list', (_e, workspaceId: string, category?: string) => {
    return listMemories(workspaceId, category)
  })

  ipcMain.handle('memory:delete', (_e, workspaceId: string, key: string) => {
    deleteMemory(workspaceId, key)
    return { ok: true }
  })

  // ── Agent routing ───────────────────────────────────────────────────────────

  ipcMain.handle('agent:route', (_e, description: string, preferredCli?: CLIType) => {
    return routeTask(description, preferredCli)
  })

  // ── PTY / Shell APIs ────────────────────────────────────────────────────────

  ipcMain.handle('shell:spawn', (_e, cliType: CLIType, workspacePath: string, workspaceId: string, goal?: string) => {
    const ptyId = `pty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const { cmd, args } = getCliCommand(cliType, workspacePath)

    let ptyProcess: nodePty.IPty
    try {
      ptyProcess = nodePty.spawn(cmd, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: workspacePath,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          LANG: 'en_US.UTF-8',
        } as Record<string, string>,
      })
    } catch (err: unknown) {
      return { error: String(err) }
    }

    createAgentSession(sessionId, workspaceId, cliType, goal)

    const session: PtySession = { pty: ptyProcess, ptyId, workspaceId, cliType, sessionId }
    ptySessions.set(ptyId, session)

    ptyProcess.onData((data: string) => {
      sessionHadActivity.add(ptyId)

      // Reset idle notification timer
      const existing = idleNotifTimers.get(ptyId)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        idleNotifTimers.delete(ptyId)
        if (!mainWindow?.isFocused() && sessionHadActivity.has(ptyId)) {
          new Notification({
            title: 'Forge — Agent Idle',
            body: `${cliType} is waiting for input`,
          }).show()
        }
      }, IDLE_NOTIFY_MS)
      idleNotifTimers.set(ptyId, timer)

      // Feed into continuation engine
      continuationOnData(ptyId, data)

      mainWindow?.webContents.send('shell:data', ptyId, data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      cleanupPtySession(ptyId)
      if (!mainWindow?.isFocused() && sessionHadActivity.has(ptyId)) {
        new Notification({
          title: 'Forge — Agent Exited',
          body: `${cliType} exited (code ${exitCode})`,
        }).show()
      }
      mainWindow?.webContents.send('shell:exit', ptyId, exitCode)
    })

    return { ptyId, sessionId }
  })

  ipcMain.on('shell:write', (_e, ptyId: string, data: string) => {
    ptySessions.get(ptyId)?.pty.write(data)
  })

  ipcMain.on('shell:resize', (_e, ptyId: string, cols: number, rows: number) => {
    ptySessions.get(ptyId)?.pty.resize(cols, rows)
  })

  ipcMain.handle('shell:kill', (_e, ptyId: string) => {
    cleanupPtySession(ptyId)
    return { ok: true }
  })

  ipcMain.handle('shell:list', () => {
    return Array.from(ptySessions.entries()).map(([id, s]) => ({
      ptyId: id, workspaceId: s.workspaceId, cliType: s.cliType,
    }))
  })

  // ── Continuation engine APIs ────────────────────────────────────────────────

  ipcMain.handle('continuation:start', (_e, ptyId: string, workspaceId: string, goal: string, maxIterations = 20) => {
    if (!mainWindow) return { error: 'No window' }
    startContinuation(
      ptyId, goal, maxIterations,
      (id) => { ptySessions.get(id)?.pty.write('continue\n') },
      mainWindow,
    )
    return { ok: true }
  })

  ipcMain.handle('continuation:stop', (_e, ptyId: string) => {
    stopContinuation(ptyId)
    return { ok: true }
  })

  ipcMain.handle('continuation:state', (_e, ptyId: string) => {
    const s = getContinuationState(ptyId)
    if (!s) return null
    return { ptyId: s.ptyId, goal: s.goal, iteration: s.currentIteration, max: s.maxIterations, status: s.status }
  })
}

// ── App lifecycle ──────────────────────────────────────────────────────────────

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

// Single instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}
