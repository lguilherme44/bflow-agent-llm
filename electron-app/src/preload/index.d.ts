import { ElectronAPI } from '@electron-toolkit/preload'

interface AgentAPI {
  loadConfig: () => Promise<Record<string, unknown>>
  saveConfig: (config: Record<string, unknown>) => Promise<{ success: boolean }>
  getWorkspace: () => Promise<string>
  getVersion: () => Promise<string>
  getMcpStatus: () => Promise<any>
  syncModels: (baseUrl: string) => Promise<{ success: boolean; models?: string[]; error?: string }>
  runAgent: (task: string) => Promise<{ success: boolean; error?: string }>
  stopAgent: () => Promise<{ success: boolean; error?: string }>
  onAgentEvent: (callback: (event: unknown) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AgentAPI
  }
}
