import { useState, useEffect } from 'react'

interface SettingsPanelProps {
  onClose: () => void
  api: any
}

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; runtimeProfile: string }> = {
  lmstudio: { baseUrl: 'http://localhost:1234/v1', runtimeProfile: 'low-vram-8gb' },
  ollama: { baseUrl: 'http://localhost:11434/v1', runtimeProfile: 'low-vram-8gb' },
  mlx: { baseUrl: 'http://localhost:8080/v1', runtimeProfile: 'mlx-16gb-unified' },
  omlx: { baseUrl: 'http://localhost:8000/v1', runtimeProfile: 'mlx-16gb-unified' },
  openai: { baseUrl: 'https://api.openai.com/v1', runtimeProfile: 'cloud' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', runtimeProfile: 'cloud' },
}

const PROFILE_LIMITS: Record<string, Record<string, number>> = {
  'low-vram-8gb': {
    maxTurns: 8,
    maxOutputTokens: 1024,
    maxInputChars: 26000,
    maxToolOutputChars: 2200,
    maxFileLines: 180,
    maxListFiles: 250,
    maxSearchMatches: 50,
    maxRagResults: 5,
  },
  'mlx-16gb-unified': {
    maxTurns: 10,
    maxOutputTokens: 1280,
    maxInputChars: 34000,
    maxToolOutputChars: 2800,
    maxFileLines: 220,
    maxListFiles: 320,
    maxSearchMatches: 60,
    maxRagResults: 6,
  },
  'balanced-local': {
    maxTurns: 12,
    maxOutputTokens: 1536,
    maxInputChars: 42000,
    maxToolOutputChars: 3500,
    maxFileLines: 260,
    maxListFiles: 400,
    maxSearchMatches: 80,
    maxRagResults: 8,
  },
  cloud: {
    maxTurns: 18,
    maxOutputTokens: 2048,
    maxInputChars: 90000,
    maxToolOutputChars: 6000,
    maxFileLines: 420,
    maxListFiles: 500,
    maxSearchMatches: 100,
    maxRagResults: 10,
  },
}

export function SettingsPanel({ onClose, api }: SettingsPanelProps): React.JSX.Element {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [workspace, setWorkspace] = useState('')
  const [loading, setLoading] = useState(true)
  const [models, setModels] = useState<string[]>([])
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    Promise.all([api.loadConfig(), api.getWorkspace()]).then(([configData, workspacePath]) => {
      setConfig(configData)
      setWorkspace(workspacePath)
      setLoading(false)
    })
  }, [api])

  const handleChange = (key: string, value: string | number) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value }

      if (key === 'provider') {
        const defaults = PROVIDER_DEFAULTS[value as string]
        if (defaults) {
          next.baseUrl = defaults.baseUrl
          next.runtimeProfile = defaults.runtimeProfile
          Object.assign(next, PROFILE_LIMITS[defaults.runtimeProfile])
        }
      }

      if (key === 'runtimeProfile') {
        Object.assign(next, PROFILE_LIMITS[value as string])
      }

      return next
    })
  }

  const handleSave = async () => {
    await api.saveConfig(config)
    onClose()
  }

  const handleOpenWorkspace = async () => {
    const result = await api.openWorkspace()
    if (result?.workspace) {
      setWorkspace(result.workspace)
    }
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
        const current = config.model as string
        if (result.models.length > 0 && (!current || !result.models.includes(current))) {
          handleChange('model', result.models[0])
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

  const isLocalProvider = ['lmstudio', 'ollama', 'mlx', 'omlx'].includes(config.provider as string)

  if (loading) {
    return <div className="settings-panel"><span className="spinner" /></div>
  }

  return (
    <div className="settings-panel">
      <div className="settings-panel__header">
        <h2>Configuracoes do Agente</h2>
        <button className="settings-panel__close" onClick={onClose}>x</button>
      </div>

      <div className="settings-panel__content">
        <div className="form-group">
          <label>Workspace</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input className="form-control" value={workspace} readOnly />
            <button className="btn btn-secondary" onClick={handleOpenWorkspace} style={{ whiteSpace: 'nowrap' }}>
              Selecionar
            </button>
          </div>
        </div>

        <div className="form-group">
          <label>Provider</label>
          <select
            value={config.provider as string}
            onChange={(e) => handleChange('provider', e.target.value)}
            className="form-control"
          >
            <option value="lmstudio">LM Studio (Local)</option>
            <option value="ollama">Ollama (Local)</option>
            <option value="mlx">MLX / mlx-lm server (Apple Silicon)</option>
            <option value="omlx">oMLX (Apple Silicon)</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        <div className="form-group">
          <label>Modelo</label>
          {isLocalProvider && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button className="btn btn-secondary" onClick={handleSyncModels} disabled={syncing}>
                {syncing ? 'Sincronizando...' : 'Sincronizar Modelos'}
              </button>
              {models.length > 0 && (
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85em', alignSelf: 'center' }}>
                  {models.length} modelo(s)
                </span>
              )}
            </div>
          )}
          {models.length > 0 ? (
            <select
              value={(config.model as string) || ''}
              onChange={(e) => handleChange('model', e.target.value)}
              className="form-control"
            >
              {models.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={(config.model as string) || ''}
              onChange={(e) => handleChange('model', e.target.value)}
              className="form-control"
              placeholder="Ex: qwen2.5-coder-7b-instruct"
            />
          )}
        </div>

        <div className="form-group">
          <label>Base URL</label>
          <input
            type="text"
            value={(config.baseUrl as string) || ''}
            onChange={(e) => handleChange('baseUrl', e.target.value)}
            className="form-control"
            placeholder="http://localhost:1234/v1"
          />
        </div>

        {(config.provider === 'omlx' || config.provider === 'openai' || config.provider === 'anthropic') && (
          <div className="form-group">
            <label>API Key</label>
            <input
              type="password"
              value={(config.apiKey as string) || ''}
              onChange={(e) => handleChange('apiKey', e.target.value)}
              className="form-control"
              placeholder="sk-..."
              autoComplete="off"
            />
          </div>
        )}

        <div className="form-group">
          <label>Perfil de runtime</label>
          <select
            value={(config.runtimeProfile as string) || 'low-vram-8gb'}
            onChange={(e) => handleChange('runtimeProfile', e.target.value)}
            className="form-control"
          >
            <option value="low-vram-8gb">Local 8GB VRAM</option>
            <option value="mlx-16gb-unified">macOS MLX 16GB unificado</option>
            <option value="balanced-local">Local balanceado</option>
            <option value="cloud">Cloud / contexto alto</option>
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <NumberField label="Max turns" field="maxTurns" config={config} onChange={handleChange} />
          <NumberField label="Output tokens" field="maxOutputTokens" config={config} onChange={handleChange} />
          <NumberField label="Input chars" field="maxInputChars" config={config} onChange={handleChange} />
          <NumberField label="Tool output chars" field="maxToolOutputChars" config={config} onChange={handleChange} />
          <NumberField label="File lines" field="maxFileLines" config={config} onChange={handleChange} />
          <NumberField label="Search matches" field="maxSearchMatches" config={config} onChange={handleChange} />
        </div>
      </div>

      <div className="settings-panel__footer">
        <button className="btn btn-primary" onClick={handleSave}>Salvar Configuracoes</button>
      </div>
    </div>
  )
}

function NumberField({
  label,
  field,
  config,
  onChange,
}: {
  label: string
  field: string
  config: Record<string, unknown>
  onChange: (key: string, value: number) => void
}) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <input
        type="number"
        value={(config[field] as number) || 1}
        onChange={(e) => onChange(field, parseInt(e.target.value, 10))}
        className="form-control"
        min={1}
      />
    </div>
  )
}
