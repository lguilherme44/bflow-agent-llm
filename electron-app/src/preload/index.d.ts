import { ElectronAPI } from '@electron-toolkit/preload'

interface AgentAPI {
  loadConfig: () => Promise<Record<string, unknown>>
  saveConfig: (config: Record<string, unknown>) => Promise<{ success: boolean }>
  getWorkspace: () => Promise<string>
  openWorkspace: () => Promise<{ success: boolean; workspace: string }>
  getVersion: () => Promise<string>
  getMcpStatus: () => Promise<any>
  connectMcp: (name: string) => Promise<any>
  disconnectMcp: (name: string) => Promise<any>
  syncModels: (baseUrl: string, apiKey?: string) => Promise<{ success: boolean; models?: string[]; error?: string }>
  runAgent: (task: string) => Promise<{ success: boolean; error?: string }>
  stopAgent: () => Promise<{ success: boolean; error?: string }>
  onAgentEvent: (callback: (event: unknown) => void) => () => void
  loadHistory: () => Promise<any[]>
  saveHistorySession: (session: any) => Promise<{ success: boolean; error?: string }>
  deleteHistorySession: (id: string) => Promise<{ success: boolean; error?: string }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AgentAPI
  }
}
