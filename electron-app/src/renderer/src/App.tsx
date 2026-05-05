import { useState, useEffect } from 'react'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'

// Safe API access — fallback when running outside Electron (e.g. browser preview)
const api = window.api ?? {
  loadConfig: async () => ({ provider: 'lmstudio', model: 'local-model', baseUrl: 'http://localhost:1234/v1', maxTurns: 15 }),
  saveConfig: async () => ({ success: true }),
  getWorkspace: async () => 'workspace',
  getVersion: async () => '1.0.0',
  runAgent: async (task: string) => { console.log('Mock runAgent:', task); return { success: true }; },
  stopAgent: async () => ({ success: true }),
  onAgentEvent: () => () => {}
}

function App(): React.JSX.Element {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [workspace, setWorkspace] = useState('')
  const [showSettings, setShowSettings] = useState(false)

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

      {/* ── Main Content ──────────────────────────────────── */}
      {showSettings ? (
        <SettingsPanel onClose={() => setShowSettings(false)} api={api} />
      ) : (
        <ChatPanel api={api} />
      )}

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
