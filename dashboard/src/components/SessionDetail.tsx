import { ChevronLeft, Trash2, Zap, Terminal, Activity, FileText } from 'lucide-react';

interface LogEntry {
  timestamp: string;
  type: 'event' | 'llm' | 'tool' | 'command' | 'file';
  agentId?: string;
  payload: any;
}

interface SessionDetailProps {
  sessionId: string;
  logs: LogEntry[];
  onBack: () => void;
  onDelete: () => void;
}

export function SessionDetail({ sessionId, logs, onBack, onDelete }: SessionDetailProps) {
  const getIcon = (type: string) => {
    switch (type) {
      case 'llm': return <Zap size={16} color="var(--accent-color)" />;
      case 'tool': return <Terminal size={16} color="var(--warning-color)" />;
      case 'command': return <Activity size={16} color="var(--success-color)" />;
      case 'file': return <FileText size={16} color="var(--accent-hover)" />;
      default: return <Activity size={16} />;
    }
  };

  return (
    <div className="animate-fade-in">
      <header className="page-header" style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={onBack} className="btn btn-ghost" style={{ padding: '10px' }}>
             <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="page-title">Detalhes da Sessão</h1>
            <div style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '4px' }}>
              ID: {sessionId}
            </div>
          </div>
        </div>
        <button 
          onClick={onDelete}
          className="btn btn-danger"
        >
          <Trash2 size={18} />
          Apagar Sessão
        </button>
      </header>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Timeline de Execução</h2>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{logs.length} eventos registrados</div>
        </div>
        <div className="log-viewer">
          {logs.map((log, i) => (
            <div key={i} className={`log-entry ${log.type}`}>
              <div className="log-meta">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.05)', 
                    padding: '6px', 
                    borderRadius: '8px',
                    display: 'flex'
                  }}>
                    {getIcon(log.type)}
                  </div>
                  <span style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>
                    {log.type}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', fontWeight: 500 }}>
                  {new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour12: false })}
                </div>
              </div>
              
              {log.type === 'event' && log.payload.event && (
                <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>
                  {log.payload.event}
                </div>
              )}
              
              <div className="log-payload">
                {typeof log.payload === 'string' ? log.payload : JSON.stringify(log.payload, null, 2)}
              </div>
            </div>
          ))}
          {logs.length === 0 && (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Nenhum log disponível para esta sessão.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
