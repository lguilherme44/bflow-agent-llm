import { useState, useEffect } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ToolActivityPanel } from './components/ToolActivityPanel'
import { FileExplorerPanel } from './components/FileExplorerPanel'
import { McpPanel } from './components/McpPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { useAgent } from './hooks/useAgent'

// Safe API access — fallback when running outside Electron (e.g. browser preview)
const api = window.api ?? {
  loadConfig: async () => ({ provider: 'lmstudio', model: 'local-model', baseUrl: 'http://localhost:1234/v1', runtimeProfile: 'low-vram-8gb', maxTurns: 8 }),
  saveConfig: async () => ({ success: true }),
  getWorkspace: async () => 'workspace',
  openWorkspace: async () => ({ success: true, workspace: 'workspace' }),
  getVersion: async () => '1.0.0',
  getMcpStatus: async () => ({ servers: [] }),
  connectMcp: async () => ({ success: true, servers: [] }),
  disconnectMcp: async () => ({ success: true, servers: [] }),
  syncModels: async (_baseUrl: string) => ({ success: true, models: ['mock-model'] }),
  runAgent: async (task: string) => { console.log('Mock runAgent:', task); return { success: true }; },
  stopAgent: async () => ({ success: true }),
  onAgentEvent: () => () => {},
  loadHistory: async () => [],
  saveHistorySession: async () => ({ success: true }),
  deleteHistorySession: async () => ({ success: true })
}

function App(): React.JSX.Element {
  const [config, setConfig] = useState<any>({})
  const [workspace, setWorkspace] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [activeTab, setActiveTab] = useState<'history' | 'tools' | 'mcp' | 'files'>('history')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)

  const { messages, toolCalls, isRunning, thinking, runAgent, stopAgent, startNewSession, loadSession } = useAgent(api)

  // Load config and workspace on mount
  useEffect(() => {
    api.loadConfig().then(setConfig)
    api.getWorkspace().then(setWorkspace)
  }, [showSettings]) // Reload config when settings modal closes

  const modelName = (config.model as string) || 'local-model'
  const providerName = (config.provider as string) || 'lmstudio'
  const workspaceName = workspace ? workspace.split(/[\\/]/).pop() : '—'

  return (
    <div className="app">
      {/* ── Title Bar ──────────────────────────────────────── */}
      <div className="titlebar">
        <div className="titlebar__brand">
          <span className="titlebar__logo">bflow</span>
          <span className="titlebar__separator">·</span>
          <span className="titlebar__label">agent</span>
        </div>
        <div className="titlebar__status">
          {!showSettings && (
            <button 
              className={`titlebar__settings-btn ${isSidebarOpen ? 'titlebar__settings-btn--active' : ''}`}
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              title="Alternar Painel Lateral"
              style={{ fontSize: '1rem', marginRight: '8px' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="15" y1="3" x2="15" y2="21"></line>
              </svg>
            </button>
          )}
          <button 
            className="titlebar__settings-btn" 
            onClick={() => setShowSettings(true)}
            title="Configurações"
          >
            ⚙️
          </button>
          <span className="badge badge--accent">{providerName}</span>
          <span className="badge">{modelName}</span>
        </div>
      </div>

      {/* ── Main Content Area ──────────────────────────────── */}
      <div className="main-layout">
        {showSettings ? (
          <SettingsPanel onClose={() => setShowSettings(false)} api={api} />
        ) : (
          <>
            <ChatPanel 
              messages={messages} 
              isRunning={isRunning} 
              thinking={thinking}
              onSend={runAgent} 
              onStop={stopAgent} 
            />
            
            <div className={`sidebar ${!isSidebarOpen ? 'sidebar--closed' : ''}`}>
              <div className="sidebar__tabs">
                <button 
                  className={`sidebar__tab ${activeTab === 'history' ? 'sidebar__tab--active' : ''}`}
                  onClick={() => setActiveTab('history')}
                >
                  History
                </button>
                <button 
                  className={`sidebar__tab ${activeTab === 'tools' ? 'sidebar__tab--active' : ''}`}
                  onClick={() => setActiveTab('tools')}
                >
                  Tools
                </button>
                <button 
                  className={`sidebar__tab ${activeTab === 'mcp' ? 'sidebar__tab--active' : ''}`}
                  onClick={() => setActiveTab('mcp')}
                >
                  MCP
                </button>
                <button 
                  className={`sidebar__tab ${activeTab === 'files' ? 'sidebar__tab--active' : ''}`}
                  onClick={() => setActiveTab('files')}
                >
                  Files
                </button>
              </div>
              <div className="sidebar__content">
                {activeTab === 'history' && <HistoryPanel api={api} onSelectSession={loadSession} onNewSession={startNewSession} />}
                {activeTab === 'tools' && <ToolActivityPanel toolCalls={toolCalls} />}
                {activeTab === 'mcp' && <McpPanel api={api} />}
                {activeTab === 'files' && <FileExplorerPanel toolCalls={toolCalls} />}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Status Bar ────────────────────────────────────── */}
      <div className="statusbar">
        <div className="statusbar__section">
          <div className="statusbar__item">
            <span className="statusbar__dot" />
            <span>Pronto</span>
          </div>
          <div className="statusbar__item">
            <span>📂 {workspaceName}</span>
          </div>
        </div>
        <div className="statusbar__section">
          <div className="statusbar__item">
            <span>⬡ 0 tokens</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
