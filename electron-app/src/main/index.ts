import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'bflow agent',
    backgroundColor: '#0a0a12',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer based on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── IPC Handlers ──────────────────────────────────────────────
// Placeholder handlers — will be expanded in Phase 1

ipcMain.handle('config:load', async () => {
  // TODO: Phase 1 — load .agentrc config
  return {
    provider: 'lmstudio',
    model: 'local-model',
    baseUrl: 'http://localhost:1234/v1',
    maxTurns: 15
  }
})

ipcMain.handle('config:save', async (_event, config: Record<string, unknown>) => {
  // TODO: Phase 1 — save config to .agentrc
  console.log('[main] config:save', config)
  return { success: true }
})

ipcMain.handle('workspace:get', async () => {
  // TODO: Phase 1 — return current workspace
  return process.cwd()
})

ipcMain.handle('app:version', async () => {
  return app.getVersion()
})

// ── App Lifecycle ─────────────────────────────────────────────

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.bflow.agent')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
