import { useState, useEffect } from 'react'

interface SettingsPanelProps {
  onClose: () => void
  api: any
}

export function SettingsPanel({ onClose, api }: SettingsPanelProps): React.JSX.Element {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [models, setModels] = useState<string[]>([])
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    api.loadConfig().then((data: any) => {
      setConfig(data)
      setLoading(false)
    })
  }, [api])

  const handleChange = (key: string, value: string | number) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value }
      // Auto-set default baseUrl when switching providers
      if (key === 'provider') {
        const defaults: Record<string, string> = {
          lmstudio: 'http://localhost:1234/v1',
          ollama: 'http://localhost:11434/v1',
          omlx: 'http://localhost:8000/v1',
          openai: 'https://api.openai.com/v1',
          anthropic: 'https://api.anthropic.com/v1',
        }
        if (defaults[value as string]) {
          next.baseUrl = defaults[value as string]
        }
      }
      return next
    })
  }

  const handleSave = async () => {
    await api.saveConfig(config)
    onClose()
  }

  const handleSyncModels = async () => {
    if (!config.baseUrl) return
    setSyncing(true)
    try {
      const result = await api.syncModels(
        config.baseUrl as string,
        (config.apiKey as string) || undefined
      )
      if (result.success && result.models) {
        setModels(result.models)
        if (result.models.length > 0) {
          // Auto-select first model if none selected or current not in list
          const current = config.model as string
          if (!current || !result.models.includes(current)) {
            handleChange('model', result.models[0])
          }
        }
      } else {
        alert(`Erro ao sincronizar: ${result.error}`)
      }
    } catch (err: any) {
      alert(`Erro inesperado: ${err.message}`)
    } finally {
      setSyncing(false)
    }
  }

  // Determine if we should show the model dropdown (local providers with sync)
  const isLocalProvider = config.provider === 'lmstudio' || config.provider === 'ollama' || config.provider === 'omlx'

  if (loading) {
    return <div className="settings-panel"><span className="spinner" /></div>
  }

  return (
    <div className="settings-panel">
      <div className="settings-panel__header">
        <h2>Configurações do Agente</h2>
        <button className="settings-panel__close" onClick={onClose}>✕</button>
      </div>

      <div className="settings-panel__content">
        <div className="form-group">
          <label>Provider</label>
          <select 
            value={config.provider as string} 
            onChange={(e) => handleChange('provider', e.target.value)}
            className="form-control"
          >
            <option value="lmstudio">LM Studio (Local)</option>
            <option value="ollama">Ollama (Local)</option>
            <option value="omlx">oMLX (Apple Silicon)</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        <div className="form-group">
          <label>Modelo</label>
          {isLocalProvider && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button 
                className="btn btn-secondary" 
                onClick={handleSyncModels}
                disabled={syncing}
                style={{ whiteSpace: 'nowrap', flex: 'none' }}
              >
                {syncing ? '⏳ Sincronizando...' : '🔄 Sincronizar Modelos'}
              </button>
              {models.length > 0 && (
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85em', alignSelf: 'center' }}>
                  {models.length} modelo{models.length > 1 ? 's' : ''} encontrado{models.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
          {models.length > 0 ? (
            <select
              value={config.model as string || ''}
              onChange={(e) => handleChange('model', e.target.value)}
              className="form-control"
            >
              {models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input 
              type="text" 
              value={config.model as string || ''} 
              onChange={(e) => handleChange('model', e.target.value)}
              className="form-control"
              placeholder="Ex: local-model, gpt-4o"
            />
          )}
        </div>

        <div className="form-group">
          <label>Base URL (Local Providers)</label>
          <input 
            type="text" 
            value={config.baseUrl as string || ''} 
            onChange={(e) => handleChange('baseUrl', e.target.value)}
            className="form-control"
            placeholder="http://localhost:1234/v1"
          />
        </div>

        {(config.provider === 'omlx' || config.provider === 'openai' || config.provider === 'anthropic') && (
          <div className="form-group">
            <label>API Key {config.provider === 'omlx' ? '(senha do oMLX)' : ''}</label>
            <input 
              type="password" 
              value={config.apiKey as string || ''} 
              onChange={(e) => handleChange('apiKey', e.target.value)}
              className="form-control"
              placeholder={config.provider === 'omlx' ? 'Senha definida no oMLX' : 'sk-...'}
              autoComplete="off"
            />
          </div>
        )}

        <div className="form-group">
          <label>Máximo de Turnos</label>
          <input 
            type="number" 
            value={config.maxTurns as number || 15} 
            onChange={(e) => handleChange('maxTurns', parseInt(e.target.value))}
            className="form-control"
            min={1}
            max={50}
          />
        </div>
      </div>

      <div className="settings-panel__footer">
        <button className="btn btn-primary" onClick={handleSave}>Salvar Configurações</button>
      </div>
    </div>
  )
}
