import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// ── bflow Agent API exposed to renderer ──────────────────────

const agentAPI = {
  // Config
  loadConfig: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('config:load'),
  saveConfig: (config: Record<string, unknown>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('config:save', config),

  // Workspace
  getWorkspace: (): Promise<string> => ipcRenderer.invoke('workspace:get'),

  // App info
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getMcpStatus: (): Promise<any> => ipcRenderer.invoke('mcp:status'),
  syncModels: (baseUrl: string): Promise<{ success: boolean; models?: string[]; error?: string }> => 
    ipcRenderer.invoke('models:sync', baseUrl),

  // Agent execution
  runAgent: (task: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('agent:run', task),
  stopAgent: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('agent:stop'),

  // Agent events (Phase 1 — will add agent:run, agent:stop, agent:event)
  onAgentEvent: (callback: (event: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  }
}

// Expose via contextBridge
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', agentAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = agentAPI
}
