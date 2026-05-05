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
