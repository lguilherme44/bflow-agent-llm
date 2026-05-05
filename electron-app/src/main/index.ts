import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { WebSocketServer } from 'ws';
// @ts-ignore
import { AgentRunner, AgentRunConfig, AgentEvent } from '@bflow/core';
import icon from '../../resources/icon.png?asset';

let mainWindow: BrowserWindow | null = null;
let agentRunner: any | null = null;
let wss: WebSocketServer | null = null;

// Store config in memory for now
let appConfig: Record<string, unknown> = {
  provider: 'lmstudio',
  model: 'local-model',
  baseUrl: 'http://localhost:1234/v1',
  maxTurns: 15
};

let currentWorkspace = process.cwd();

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
    appConfig = { ...appConfig, ...config };
    console.log('[IPC] Config saved:', appConfig);
    return { success: true };
  });

  ipcMain.handle('workspace:get', async () => {
    return currentWorkspace;
  });

  ipcMain.handle('app:version', async () => {
    return app.getVersion();
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
