import React, { useState, useEffect } from 'react'

interface HistorySession {
  id: string
  title: string
  timestamp: number
}

interface HistoryPanelProps {
  api: any
  onSelectSession: (session: any) => void
  onNewSession: () => void
}

export function HistoryPanel({ api, onSelectSession, onNewSession }: HistoryPanelProps): React.JSX.Element {
  const [sessions, setSessions] = useState<HistorySession[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadHistory = async () => {
    setIsLoading(true)
    try {
      const history = await api.loadHistory()
      setSessions(history)
    } catch (err) {
      console.error('Failed to load history', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [api])

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm('Tem certeza que deseja excluir esta conversa?')) {
      await api.deleteHistorySession(id)
      await loadHistory()
    }
  }

  return (
    <div className="history-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Conversas Recentes
        </h3>
        <button 
          className="btn btn--primary" 
          onClick={onNewSession}
          style={{ padding: '4px 12px', fontSize: '12px' }}
        >
          + Novo
        </button>
      </div>

      <div className="history-list" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {isLoading ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>
            Carregando histórico...
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>
            Nenhuma conversa salva.
          </div>
        ) : (
          sessions.map(session => (
            <div 
              key={session.id} 
              className="history-item"
              onClick={async () => {
                // Find the full session object to load
                const fullHistory = await api.loadHistory()
                const fullSession = fullHistory.find((s: any) => s.id === session.id)
                if (fullSession) onSelectSession(fullSession)
              }}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 12px',
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: '6px',
                cursor: 'pointer',
                border: '1px solid var(--border-color)',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)')}
            >
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '12px' }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  {session.title || 'Conversa sem título'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {new Date(session.timestamp).toLocaleString()}
                </div>
              </div>
              <button
                onClick={(e) => handleDelete(session.id, e)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '4px'
                }}
                title="Excluir"
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--error-color)', e.currentTarget.style.backgroundColor = 'rgba(255,0,0,0.1)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)', e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18"></path>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
