import { ElectronAPI } from '@electron-toolkit/preload'

interface AgentAPI {
  loadConfig: () => Promise<Record<string, unknown>>
  saveConfig: (config: Record<string, unknown>) => Promise<{ success: boolean }>
  getWorkspace: () => Promise<string>
  getVersion: () => Promise<string>
  onAgentEvent: (callback: (event: unknown) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AgentAPI
  }
}
