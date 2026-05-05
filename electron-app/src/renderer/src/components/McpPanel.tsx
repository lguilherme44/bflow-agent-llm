import { useState, useEffect } from 'react'

interface McpPanelProps {
  api: any
}

export function McpPanel({ api }: McpPanelProps): React.JSX.Element {
  const [servers, setServers] = useState<any[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const fetchStatus = async () => {
    try {
      const data = await api.getMcpStatus()
      setServers(data.servers || [])
    } catch (err) {
      console.error('Failed to fetch MCP status', err)
    }
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [api])

  const connect = async (name: string) => {
    setBusy(name)
    try {
      const result = await api.connectMcp(name)
      setServers(result.servers || [])
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async (name: string) => {
    setBusy(name)
    try {
      const result = await api.disconnectMcp(name)
      setServers(result.servers || [])
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="activity-panel">
      <div className="activity-panel__header">
        <h3>Model Context Protocol</h3>
      </div>
      <div className="activity-panel__content">
        {servers.length === 0 ? (
          <div className="activity-panel__empty">Nenhum servidor MCP configurado neste workspace.</div>
        ) : (
          servers.map((server) => (
            <div key={server.name} className={`tool-card ${server.connected ? 'tool-card--success' : 'tool-card--pending'}`}>
              <div className="tool-card__header">
                <span className="tool-card__name">{server.name}</span>
                <span className="badge badge--accent">{server.connected ? 'Conectado' : server.transport}</span>
              </div>
              {server.error && (
                <div className="tool-card__result">
                  <pre>{server.error}</pre>
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                {server.connected ? (
                  <button className="btn btn-secondary" onClick={() => disconnect(server.name)} disabled={busy === server.name}>
                    Desconectar
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={() => connect(server.name)} disabled={busy === server.name}>
                    Conectar
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
