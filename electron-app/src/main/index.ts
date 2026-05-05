import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { WebSocketServer, WebSocket } from 'ws';
import { AgentRunner, MCPManager, resolveLocalRuntimeProfile } from '@bflow/core';
import type { AgentEvent } from '@bflow/core';
import icon from '../../resources/icon.png?asset';
import fs from 'fs';

interface ProviderBreakdown {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  calls: number;
}

interface RuntimeLogEntry {
  timestamp: string;
  type: 'event' | 'llm' | 'tool' | 'command' | 'file';
  agentId?: string;
  payload: Record<string, unknown>;
}

interface RuntimeSession {
  id: string;
  task: string;
  prompt: string;
  startTime: string;
  lastUpdateTime: string;
  status: 'completed' | 'error' | 'in_progress';
  success: boolean;
  logs: RuntimeLogEntry[];
}

let mainWindow: BrowserWindow | null = null;
let agentRunner: AgentRunner | null = null;
let wss: WebSocketServer | null = null;
let mcpManager: MCPManager | null = null;
let activeSessionId: string | null = null;
let currentWorkspace = process.cwd();
let dashboardSessions: RuntimeSession[] = [];

function configureWritableAppPaths(): void {
  if (process.platform !== 'win32') return;

  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const userDataRoot = process.env.BFLOW_AGENT_USER_DATA || join(localAppData, 'bflow-agent');
  const sessionData = join(userDataRoot, 'session');
  const cacheData = join(userDataRoot, 'cache');

  for (const dir of [userDataRoot, sessionData, cacheData]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  app.setPath('userData', userDataRoot);
  try {
    app.setPath('sessionData', sessionData);
  } catch {
    // sessionData is not available in older Electron builds.
  }
  app.commandLine.appendSwitch('disk-cache-dir', cacheData);
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
}

configureWritableAppPaths();

const getConfigPath = () => join(app.getPath('userData'), 'bflow-agent-config.json');
const getHistoryPath = () => join(app.getPath('userData'), 'bflow-agent-history.json');
const getDashboardPath = () => join(app.getPath('userData'), 'bflow-agent-dashboard.json');

const defaultConfig: Record<string, unknown> = {
  provider: process.platform === 'darwin' ? 'mlx' : 'lmstudio',
  model: 'local-model',
  baseUrl: process.platform === 'darwin' ? 'http://localhost:8080/v1' : 'http://localhost:1234/v1',
  apiKey: '',
  runtimeProfile: process.platform === 'darwin' ? 'mlx-16gb-unified' : 'low-vram-8gb',
  maxTurns: process.platform === 'darwin' ? 10 : 8,
  maxOutputTokens: process.platform === 'darwin' ? 1280 : 1024,
  maxInputChars: process.platform === 'darwin' ? 34000 : 26000,
  maxToolOutputChars: process.platform === 'darwin' ? 2800 : 2200,
  maxFileLines: process.platform === 'darwin' ? 220 : 180,
  maxListFiles: process.platform === 'darwin' ? 320 : 250,
  maxSearchMatches: process.platform === 'darwin' ? 60 : 50,
  maxRagResults: process.platform === 'darwin' ? 6 : 5,
  temperature: 0.1,
  websocketPort: 3030,
};

let appConfig = { ...defaultConfig };

function loadConfig(): void {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      appConfig = { ...defaultConfig, ...JSON.parse(fs.readFileSync(p, 'utf-8')) };
    }
  } catch (err) {
    console.error('[IPC] Failed to load config:', err);
  }
}

function saveConfig(config: Record<string, unknown>): void {
  appConfig = { ...appConfig, ...config };
  const runtime = resolveLocalRuntimeProfile({
    provider: appConfig.provider as string,
    model: appConfig.model as string,
    runtimeProfile: appConfig.runtimeProfile as string,
    maxTurns: appConfig.maxTurns as number,
    maxOutputTokens: appConfig.maxOutputTokens as number,
    maxInputChars: appConfig.maxInputChars as number,
    maxToolOutputChars: appConfig.maxToolOutputChars as number,
    maxFileLines: appConfig.maxFileLines as number,
    maxListFiles: appConfig.maxListFiles as number,
    maxSearchMatches: appConfig.maxSearchMatches as number,
    maxRagResults: appConfig.maxRagResults as number,
    temperature: appConfig.temperature as number,
  });

  appConfig = {
    ...appConfig,
    maxTurns: runtime.maxTurns,
    maxOutputTokens: runtime.maxOutputTokens,
    maxInputChars: runtime.maxInputChars,
    maxToolOutputChars: runtime.maxToolOutputChars,
    maxFileLines: runtime.maxFileLines,
    maxListFiles: runtime.maxListFiles,
    maxSearchMatches: runtime.maxSearchMatches,
    maxRagResults: runtime.maxRagResults,
    temperature: runtime.temperature,
  };

  fs.writeFileSync(getConfigPath(), JSON.stringify(appConfig, null, 2), 'utf-8');
}

function loadDashboardSessions(): void {
  try {
    const p = getDashboardPath();
    if (fs.existsSync(p)) {
      dashboardSessions = JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch (err) {
    console.error('[Dashboard] Failed to load sessions:', err);
    dashboardSessions = [];
  }
}

function saveDashboardSessions(): void {
  try {
    fs.writeFileSync(getDashboardPath(), JSON.stringify(dashboardSessions.slice(0, 200), null, 2), 'utf-8');
  } catch (err) {
    console.error('[Dashboard] Failed to save sessions:', err);
  }
}

function setupWebSocketServer(): void {
  const port = Number(appConfig.websocketPort || 3030);
  wss = new WebSocketServer({ port });
  console.log(`[WebSocket] Server running on ws://localhost:${port}`);

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'system', content: 'Connected to bflow-agent' }));
    sendDashboardSnapshot(ws);

    ws.on('message', (message) => {
      handleDashboardMessage(ws, message.toString());
    });
  });
}

function handleDashboardMessage(ws: WebSocket, raw: string): void {
  let message: any;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (message.type === 'dashboard:get_snapshot') {
    sendDashboardSnapshot(ws);
  } else if (message.type === 'dashboard:get_session' && typeof message.sessionId === 'string') {
    const session = dashboardSessions.find((s) => s.id === message.sessionId);
    ws.send(JSON.stringify({
      type: 'dashboard:session',
      sessionId: message.sessionId,
      logs: session?.logs ?? [],
      breakdown: session ? buildSessionBreakdown(session) : null,
    }));
  } else if (message.type === 'dashboard:get_traces') {
    ws.send(JSON.stringify({
      type: 'dashboard:traces',
      traces: buildDashboardTraces(),
    }));
  } else if (message.type === 'dashboard:delete_session' && typeof message.sessionId === 'string') {
    dashboardSessions = dashboardSessions.filter((s) => s.id !== message.sessionId);
    saveDashboardSessions();
    broadcastDashboardSnapshot();
  } else if (message.type === 'dashboard:clear_sessions') {
    dashboardSessions = [];
    saveDashboardSessions();
    broadcastDashboardSnapshot();
  }
}

function buildDashboardTraces() {
  return dashboardSessions.flatMap((session) =>
    session.logs.map((log) => ({
      name: `${log.type}:${String(log.payload.event ?? log.payload.toolName ?? 'event')}`,
      duration: [0, Number(log.payload.durationMs ?? log.payload.latencyMs ?? 0) * 1_000_000],
      context: { traceId: session.id },
      attributes: {
        component: log.type,
        sessionId: session.id,
        task: session.task,
        ...log.payload,
      },
    }))
  ).slice(-500);
}

function broadcastEvent(event: AgentEvent): void {
  if (mainWindow) {
    mainWindow.webContents.send('agent:event', event);
  }

  broadcastJson({
    type: 'agent:event',
    sessionId: activeSessionId,
    event,
  });
}

function broadcastJson(payload: unknown): void {
  if (!wss) return;
  const raw = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  });
}

function sendDashboardSnapshot(ws: WebSocket): void {
  ws.send(JSON.stringify({
    type: 'dashboard:snapshot',
    sessions: dashboardSessions.map(buildSessionMetadata),
    stats: buildDashboardStats(),
  }));
}

function broadcastDashboardSnapshot(): void {
  broadcastJson({
    type: 'dashboard:snapshot',
    sessions: dashboardSessions.map(buildSessionMetadata),
    stats: buildDashboardStats(),
  });
}

function recordAgentEvent(sessionId: string, event: AgentEvent): void {
  const session = dashboardSessions.find((s) => s.id === sessionId);
  if (!session) return;

  const timestamp = new Date().toISOString();
  session.lastUpdateTime = timestamp;

  if (event.type === 'complete') {
    session.status = 'completed';
    session.success = true;
  } else if (event.type === 'error') {
    session.status = 'error';
    session.success = false;
  }

  session.logs.push(toRuntimeLog(sessionId, event, timestamp));
  saveDashboardSessions();
}

function toRuntimeLog(sessionId: string, event: AgentEvent, timestamp: string): RuntimeLogEntry {
  if (event.type === 'llm') {
    return {
      timestamp,
      type: 'llm',
      agentId: sessionId,
      payload: {
        provider: event.metadata?.provider ?? appConfig.provider,
        model: event.metadata?.model ?? appConfig.model,
        usage: event.metadata?.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latencyMs: event.metadata?.latencyMs ?? 0,
        requestMessages: event.metadata?.requestMessages ?? 0,
      },
    };
  }

  if (event.type === 'tool_call' || event.type === 'tool_result') {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(event.content);
    } catch {
      parsed = { raw: event.content };
    }

    return {
      timestamp,
      type: 'tool',
      agentId: sessionId,
      payload: {
        phase: event.type === 'tool_call' ? 'call' : 'result',
        toolName: event.metadata?.tool ?? parsed.tool ?? 'unknown',
        success: event.metadata?.success ?? parsed.success ?? event.type === 'tool_call',
        durationMs: event.metadata?.durationMs ?? parsed.durationMs ?? 0,
        arguments: parsed.arguments,
        result: parsed.result,
      },
    };
  }

  return {
    timestamp,
    type: 'event',
    agentId: sessionId,
    payload: {
      event: event.type,
      content: event.content,
      ...event.metadata,
    },
  };
}

function buildSessionMetadata(session: RuntimeSession) {
  const breakdown = buildSessionBreakdown(session);
  return {
    id: session.id,
    startTime: session.startTime,
    lastUpdateTime: session.lastUpdateTime,
    task: session.task,
    prompt: session.prompt ?? session.task,
    status: session.status,
    tokenUsage: breakdown.tokenUsage.total,
    promptTokens: breakdown.tokenUsage.prompt,
    completionTokens: breakdown.tokenUsage.completion,
    estimatedCostUsd: breakdown.estimatedCostUsd,
    avgLatencyMs: breakdown.avgLatencyMs,
    providerBreakdown: breakdown.providers,
    toolCallCount: breakdown.toolCalls.total,
    toolErrorCount: breakdown.toolCalls.error,
    success: session.success,
  };
}

function buildSessionBreakdown(session: RuntimeSession) {
  const llmLogs = session.logs.filter((log) => log.type === 'llm');
  const toolResultLogs = session.logs.filter((log) => log.type === 'tool' && log.payload.phase === 'result');

  const providerMap = new Map<string, ProviderBreakdown>();
  let promptTokens = 0;
  let completionTokens = 0;
  let totalLatencyMs = 0;

  for (const log of llmLogs) {
    const usage = log.payload.usage as any;
    const provider = String(log.payload.provider ?? 'local');
    const model = String(log.payload.model ?? 'local-model');
    const prompt = Number(usage?.promptTokens ?? 0);
    const completion = Number(usage?.completionTokens ?? 0);
    promptTokens += prompt;
    completionTokens += completion;
    totalLatencyMs += Number(log.payload.latencyMs ?? 0);

    const key = `${provider}:${model}`;
    const current = providerMap.get(key) ?? {
      provider,
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      calls: 0,
    };
    current.promptTokens += prompt;
    current.completionTokens += completion;
    current.totalTokens += prompt + completion;
    current.calls += 1;
    current.estimatedCostUsd = estimateCostUsd(provider, current.promptTokens, current.completionTokens);
    providerMap.set(key, current);
  }

  const byTool: Record<string, { total: number; success: number; error: number; avgDurationMs: number; durations: number[] }> = {};
  for (const log of toolResultLogs) {
    const name = String(log.payload.toolName ?? 'unknown');
    byTool[name] ??= { total: 0, success: 0, error: 0, avgDurationMs: 0, durations: [] };
    byTool[name].total += 1;
    if (log.payload.success === false) byTool[name].error += 1;
    else byTool[name].success += 1;
    byTool[name].durations.push(Number(log.payload.durationMs ?? 0));
  }

  const summarizedByTool: Record<string, { total: number; success: number; error: number; avgDurationMs: number }> = {};
  for (const [name, data] of Object.entries(byTool)) {
    summarizedByTool[name] = {
      total: data.total,
      success: data.success,
      error: data.error,
      avgDurationMs: data.durations.length
        ? Math.round(data.durations.reduce((sum, value) => sum + value, 0) / data.durations.length)
        : 0,
    };
  }

  return {
    sessionId: session.id,
    task: session.task,
    prompt: session.prompt ?? session.task,
    status: session.status,
    tokenUsage: {
      prompt: promptTokens,
      completion: completionTokens,
      total: promptTokens + completionTokens,
    },
    estimatedCostUsd: Array.from(providerMap.values()).reduce((sum, provider) => sum + provider.estimatedCostUsd, 0),
    avgLatencyMs: llmLogs.length ? Math.round(totalLatencyMs / llmLogs.length) : 0,
    providers: Array.from(providerMap.values()),
    toolCalls: {
      total: toolResultLogs.length,
      success: toolResultLogs.filter((log) => log.payload.success !== false).length,
      error: toolResultLogs.filter((log) => log.payload.success === false).length,
      byTool: summarizedByTool,
    },
    timeline: session.logs.slice(-200).map((log) => ({
      timestamp: log.timestamp,
      type: log.type,
      tokensUsed: log.type === 'llm' ? Number((log.payload.usage as any)?.totalTokens ?? 0) : undefined,
      toolName: log.type === 'tool' ? String(log.payload.toolName ?? '') : undefined,
      success: log.type === 'tool' ? Boolean(log.payload.success) : undefined,
      durationMs: Number(log.payload.durationMs ?? log.payload.latencyMs ?? 0),
    })),
  };
}

function buildDashboardStats() {
  const metadata = dashboardSessions.map(buildSessionMetadata);
  const totalSessions = metadata.length;
  const completed = metadata.filter((s) => s.status === 'completed').length;
  const errors = metadata.filter((s) => s.status === 'error').length;
  const totalTokens = metadata.reduce((sum, s) => sum + s.tokenUsage, 0);
  const totalPromptTokens = metadata.reduce((sum, s) => sum + s.promptTokens, 0);
  const totalCompletionTokens = metadata.reduce((sum, s) => sum + s.completionTokens, 0);
  const totalEstimatedCostUsd = metadata.reduce((sum, s) => sum + s.estimatedCostUsd, 0);
  const latencySamples = metadata.map((s) => s.avgLatencyMs).filter((value) => value > 0);

  return {
    totalSessions,
    successRate: totalSessions ? (completed / totalSessions) * 100 : 0,
    errorRate: totalSessions ? (errors / totalSessions) * 100 : 0,
    totalTokens,
    totalPromptTokens,
    totalCompletionTokens,
    totalEstimatedCostUsd,
    avgLatencyMs: latencySamples.length
      ? Math.round(latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length)
      : 0,
    avgTokensPerSession: totalSessions ? Math.round(totalTokens / totalSessions) : 0,
  };
}

function estimateCostUsd(provider: string, promptTokens: number, completionTokens: number): number {
  const localProviders = new Set(['lmstudio', 'ollama', 'mlx', 'mlx-lm', 'omlx', 'local']);
  if (localProviders.has(provider.toLowerCase())) return 0;
  return (promptTokens / 1_000_000) * 2.5 + (completionTokens / 1_000_000) * 10;
}

async function ensureMcpManager(): Promise<MCPManager> {
  if (!mcpManager) {
    mcpManager = new MCPManager();
  }
  await mcpManager.loadConfig(join(currentWorkspace, 'mcp-servers.json'));
  return mcpManager;
}

function setupIpcHandlers(): void {
  ipcMain.handle('config:load', async () => appConfig);

  ipcMain.handle('config:save', async (_event, config: Record<string, unknown>) => {
    saveConfig(config);
    return { success: true };
  });

  ipcMain.handle('workspace:get', async () => currentWorkspace);

  ipcMain.handle('workspace:open', async () => {
    const options: OpenDialogOptions = {
      properties: ['openDirectory'],
      defaultPath: currentWorkspace,
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, workspace: currentWorkspace };
    }
    currentWorkspace = result.filePaths[0];
    mcpManager = null;
    return { success: true, workspace: currentWorkspace };
  });

  ipcMain.handle('app:version', async () => app.getVersion());

  ipcMain.handle('mcp:status', async () => {
    const manager = await ensureMcpManager();
    return { servers: manager.getServerStatuses() };
  });

  ipcMain.handle('mcp:connect', async (_event, name: string) => {
    const manager = await ensureMcpManager();
    await manager.connectServer(name);
    return { success: true, servers: manager.getServerStatuses() };
  });

  ipcMain.handle('mcp:disconnect', async (_event, name: string) => {
    const manager = await ensureMcpManager();
    await manager.disconnectServer(name);
    return { success: true, servers: manager.getServerStatuses() };
  });

  ipcMain.handle('models:sync', async (_event, baseUrl: string, apiKey?: string) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const key = apiKey || (appConfig.apiKey as string);
      if (key) headers.Authorization = `Bearer ${key}`;

      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return { success: true, models: (data.data ?? []).map((m: any) => m.id).filter(Boolean) };
    } catch (err: any) {
      console.error('[IPC] Failed to sync models:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('agent:run', async (_event, task: string) => {
    if (agentRunner) {
      return { success: false, error: 'Agent is already running' };
    }

    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const promptTokensEstimate = estimatePromptTokens(task);
    const session: RuntimeSession = {
      id: sessionId,
      task,
      prompt: task,
      startTime: now,
      lastUpdateTime: now,
      status: 'in_progress',
      success: false,
      logs: [
        {
          timestamp: now,
          type: 'event',
          agentId: sessionId,
          payload: {
            event: 'run_started',
            prompt: task,
            promptChars: task.length,
            estimatedPromptTokens: promptTokensEstimate,
            provider: appConfig.provider,
            model: appConfig.model,
            runtimeProfile: appConfig.runtimeProfile,
            workspaceRoot: currentWorkspace,
          },
        },
      ],
    };
    dashboardSessions.unshift(session);
    activeSessionId = sessionId;
    saveDashboardSessions();
    broadcastDashboardSnapshot();

    try {
      agentRunner = new AgentRunner();

      const runConfig = {
        task,
        workspaceRoot: currentWorkspace,
        provider: appConfig.provider as string,
        model: appConfig.model as string,
        baseUrl: appConfig.baseUrl as string,
        apiKey: (appConfig.apiKey as string) || undefined,
        runtimeProfile: appConfig.runtimeProfile as string,
        maxTurns: appConfig.maxTurns as number,
        maxOutputTokens: appConfig.maxOutputTokens as number,
        maxInputChars: appConfig.maxInputChars as number,
        maxToolOutputChars: appConfig.maxToolOutputChars as number,
        maxFileLines: appConfig.maxFileLines as number,
        maxListFiles: appConfig.maxListFiles as number,
        maxSearchMatches: appConfig.maxSearchMatches as number,
        maxRagResults: appConfig.maxRagResults as number,
        temperature: appConfig.temperature as number,
      };

      (async () => {
        try {
          for await (const event of agentRunner!.run(runConfig)) {
            recordAgentEvent(sessionId, event);
            broadcastEvent(event);
            if (event.type === 'llm' || event.type === 'tool_result' || event.type === 'complete' || event.type === 'error') {
              broadcastDashboardSnapshot();
            }
          }
        } catch (error: any) {
          const event: AgentEvent = { type: 'error', content: error.message || 'Unknown error' };
          recordAgentEvent(sessionId, event);
          broadcastEvent(event);
          broadcastDashboardSnapshot();
        } finally {
          agentRunner = null;
          activeSessionId = null;
        }
      })();

      return { success: true, sessionId };
    } catch (error: any) {
      agentRunner = null;
      activeSessionId = null;
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('agent:stop', async () => {
    if (!agentRunner) {
      return { success: false, error: 'Agent is not running' };
    }

    agentRunner.stop();
    agentRunner = null;
    const event: AgentEvent = { type: 'error', content: 'Execucao interrompida pelo usuario.' };
    if (activeSessionId) {
      recordAgentEvent(activeSessionId, event);
    }
    broadcastEvent(event);
    broadcastDashboardSnapshot();
    return { success: true };
  });

  ipcMain.handle('history:load', async () => {
    try {
      const p = getHistoryPath();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
      return [];
    } catch (err) {
      console.error('[IPC] Failed to load history:', err);
      return [];
    }
  });

  ipcMain.handle('history:saveSession', async (_event, session: any) => {
    try {
      const p = getHistoryPath();
      let history: any[] = [];
      if (fs.existsSync(p)) history = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const index = history.findIndex((s) => s.id === session.id);
      if (index >= 0) history[index] = session;
      else history.unshift(session);
      fs.writeFileSync(p, JSON.stringify(history, null, 2), 'utf-8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('history:deleteSession', async (_event, sessionId: string) => {
    try {
      const p = getHistoryPath();
      if (fs.existsSync(p)) {
        const history = JSON.parse(fs.readFileSync(p, 'utf-8')).filter((s: any) => s.id !== sessionId);
        fs.writeFileSync(p, JSON.stringify(history, null, 2), 'utf-8');
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

function estimatePromptTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
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
      nodeIntegration: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.bflow.agent');
  loadConfig();
  loadDashboardSessions();

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

app.on('before-quit', async () => {
  wss?.close();
  await mcpManager?.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
