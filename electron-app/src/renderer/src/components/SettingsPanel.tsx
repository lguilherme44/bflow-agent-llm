import { useState, useEffect } from 'react'

interface SettingsPanelProps {
  onClose: () => void
  api: any
}

export function SettingsPanel({ onClose, api }: SettingsPanelProps): React.JSX.Element {
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.loadConfig().then((data: any) => {
      setConfig(data)
      setLoading(false)
    })
  }, [api])

  const handleChange = (key: string, value: string | number) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    await api.saveConfig(config)
    onClose()
  }

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
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        <div className="form-group">
          <label>Modelo</label>
          <input 
            type="text" 
            value={config.model as string || ''} 
            onChange={(e) => handleChange('model', e.target.value)}
            className="form-control"
            placeholder="Ex: local-model, gpt-4o, claude-3-5-sonnet-20240620"
          />
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
