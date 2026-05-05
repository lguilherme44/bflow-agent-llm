import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { WebSocketServer } from 'ws';
import { AgentRunner } from '@bflow/core';
import type { AgentEvent } from '@bflow/core';
import icon from '../../resources/icon.png?asset';

import fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let agentRunner: AgentRunner | null = null;
let wss: WebSocketServer | null = null;

let currentWorkspace = process.cwd();

// Store config in file
const getConfigPath = () => join(app.getPath('userData'), 'bflow-agent-config.json');

const defaultConfig: Record<string, unknown> = {
  provider: 'lmstudio',
  model: 'local-model',
  baseUrl: 'http://localhost:1234/v1',
  maxTurns: 15
};

let appConfig = { ...defaultConfig };

function loadConfig() {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p, 'utf-8');
      appConfig = { ...defaultConfig, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('[IPC] Failed to load config:', err);
  }
}

function saveConfig(config: Record<string, unknown>) {
  try {
    appConfig = { ...appConfig, ...config };
    fs.writeFileSync(getConfigPath(), JSON.stringify(appConfig, null, 2), 'utf-8');
    console.log('[IPC] Config saved:', appConfig);
  } catch (err) {
    console.error('[IPC] Failed to save config:', err);
  }
}

// Initialize config on startup
app.whenReady().then(() => {
  loadConfig();
});

function setupWebSocketServer() {
  wss = new WebSocketServer({ port: 3030 });
  console.log('[WebSocket] Server running on ws://localhost:3030');

  wss.on('connection', (ws) => {
    console.log('[WebSocket] Client connected (Dashboard)');
    ws.send(JSON.stringify({ type: 'system', content: 'Connected to bflow-agent' }));

    ws.on('message', (message) => {
      console.log(`[WebSocket] Received: ${message}`);
    });
  });
}

function broadcastEvent(event: any) {
  // Send to React UI via IPC
  if (mainWindow) {
    mainWindow.webContents.send('agent:event', event);
  }

  // Send to Dashboard via WebSocket
  if (wss) {
    const payload = JSON.stringify(event);
    wss.clients.forEach((client) => {
      if (client.readyState === 1 /* OPEN */) {
        client.send(payload);
      }
    });
  }
}

function setupIpcHandlers() {
  ipcMain.handle('config:load', async () => {
    return appConfig;
  });

  ipcMain.handle('config:save', async (_event, config: Record<string, unknown>) => {
    saveConfig(config);
    return { success: true };
  });

  ipcMain.handle('workspace:get', async () => {
    return currentWorkspace;
  });

  ipcMain.handle('app:version', async () => {
    return app.getVersion();
  });

  ipcMain.handle('mcp:status', async () => {
    return { servers: [] };
  });

  ipcMain.handle('models:sync', async (_event, baseUrl: string) => {
    try {
      // Standard OpenAI endpoint for listing models
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return { success: true, models: data.data.map((m: any) => m.id) };
    } catch (err: any) {
      console.error('[IPC] Failed to sync models:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Agent IPC handlers
  ipcMain.handle('agent:run', async (_event, task: string) => {
    if (agentRunner) {
      return { success: false, error: 'Agent is already running' };
    }

    try {
      agentRunner = new AgentRunner();
      
      const runConfig: any = {
        task,
        workspaceRoot: currentWorkspace,
        model: appConfig.model as string,
        baseUrl: appConfig.baseUrl as string,
        maxTurns: appConfig.maxTurns as number
      };

      // Start processing events in background
      (async () => {
        try {
          for await (const event of agentRunner.run(runConfig)) {
            broadcastEvent(event);
          }
        } catch (error: any) {
          broadcastEvent({ type: 'error', content: error.message || 'Unknown error' });
        } finally {
          agentRunner = null;
        }
      })();

      return { success: true };
    } catch (error: any) {
      agentRunner = null;
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('agent:stop', async () => {
    if (agentRunner) {
      agentRunner.stop();
      agentRunner = null;
      broadcastEvent({ type: 'message', content: 'Execução interrompida pelo usuário.' });
      return { success: true };
    }
    return { success: false, error: 'Agent is not running' };
  });
}

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
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.bflow.agent');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  setupWebSocketServer();
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
