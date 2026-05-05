import React, { useState, useEffect } from 'react'

interface McpPanelProps {
  api: any
}

export function McpPanel({ api }: McpPanelProps): React.JSX.Element {
  const [servers, setServers] = useState<any[]>([])

  useEffect(() => {
    // Basic polling for MVP since we don't stream MCP changes yet
    const fetchStatus = async () => {
      try {
        const data = await api.getMcpStatus()
        setServers(data.servers || [])
      } catch (err) {
        console.error('Failed to fetch MCP status', err)
      }
    }
    
    fetchStatus()
    const interval = setInterval(fetchStatus, 3000)
    return () => clearInterval(interval)
  }, [api])

  return (
    <div className="activity-panel">
      <div className="activity-panel__header">
        <h3>Model Context Protocol</h3>
      </div>
      <div className="activity-panel__content">
        {servers.length === 0 ? (
          <div className="activity-panel__empty">Nenhum servidor MCP conectado.</div>
        ) : (
          servers.map((server, idx) => (
            <div key={idx} className="tool-card tool-card--success">
              <div className="tool-card__header">
                <span className="tool-card__name">{server.name || 'Servidor MCP'}</span>
                <span className="badge badge--accent">Conectado</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
