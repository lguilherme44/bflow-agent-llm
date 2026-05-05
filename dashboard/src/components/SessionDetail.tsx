import { ChevronLeft, Trash2, Zap, Terminal, Activity, FileText, DollarSign, AlertCircle, CheckCircle, BarChart3 } from 'lucide-react';
import type { SessionBreakdown } from '../App';

interface LogEntry {
  timestamp: string;
  type: 'event' | 'llm' | 'tool' | 'command' | 'file';
  agentId?: string;
  payload: any;
}

interface SessionDetailProps {
  sessionId: string;
  logs: LogEntry[];
  breakdown: SessionBreakdown | null;
  onBack: () => void;
  onDelete: () => void;
}

export function SessionDetail({ sessionId, logs, breakdown, onBack, onDelete }: SessionDetailProps) {
  const getIcon = (type: string) => {
    switch (type) {
      case 'llm': return <Zap size={16} color="var(--accent-color)" />;
      case 'tool': return <Terminal size={16} color="var(--warning-color)" />;
      case 'command': return <Activity size={16} color="var(--success-color)" />;
      case 'file': return <FileText size={16} color="var(--accent-hover)" />;
      default: return <Activity size={16} />;
    }
  };

  const formatUsd = (value: number) => `$${value.toFixed(6)}`;
  const formatMs = (value: number) => value > 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;

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

      {/* BREAKDOWN PANEL */}
      {breakdown && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
          <div className="stat-card">
            <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={16} color="var(--warning-color)" />
              Total Tokens
            </div>
            <div className="stat-value" style={{ color: 'var(--warning-color)' }}>
              {breakdown.tokenUsage.total.toLocaleString()}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Prompt: {breakdown.tokenUsage.prompt.toLocaleString()} | Comp: {breakdown.tokenUsage.completion.toLocaleString()}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <DollarSign size={16} color="var(--success-color)" />
              Custo Estimado
            </div>
            <div className="stat-value" style={{ color: 'var(--success-color)' }}>
              {formatUsd(breakdown.estimatedCostUsd)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {breakdown.providers.length} provider(s)
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={16} color="var(--accent-color)" />
              Latência Média
            </div>
            <div className="stat-value" style={{ color: 'var(--accent-color)' }}>
              {formatMs(breakdown.avgLatencyMs)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Por chamada LLM
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={16} color="var(--accent-hover)" />
              Tool Calls
            </div>
            <div className="stat-value" style={{ color: 'var(--accent-hover)' }}>
              {breakdown.toolCalls.total}
            </div>
            <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>
              <span style={{ color: 'var(--success-color)' }}>{breakdown.toolCalls.success} ✓</span>
              {' '}
              {breakdown.toolCalls.error > 0 && (
                <span style={{ color: 'var(--error-color)' }}>{breakdown.toolCalls.error} ✗</span>
              )}
            </div>
          </div>
        </div>
      )}

      {breakdown?.prompt && (
        <div className="card" style={{ marginBottom: '32px' }}>
          <div className="card-header">
            <h2 className="card-title">Prompt original</h2>
          </div>
          <pre className="log-payload" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {breakdown.prompt}
          </pre>
        </div>
      )}

      {/* PROVIDER BREAKDOWN */}
      {breakdown && breakdown.providers.length > 0 && (
        <div className="card" style={{ marginBottom: '32px' }}>
          <div className="card-header">
            <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BarChart3 size={18} />
              Breakdown por Provider
            </h2>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Modelo</th>
                  <th>Prompt</th>
                  <th>Completion</th>
                  <th>Total</th>
                  <th>Custo</th>
                  <th>Chamadas</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.providers.map((p, i) => (
                  <tr key={i}>
                    <td style={{ textTransform: 'capitalize', fontWeight: 600 }}>{p.provider}</td>
                    <td><code style={{ fontSize: '0.75rem' }}>{p.model}</code></td>
                    <td>{p.promptTokens.toLocaleString()}</td>
                    <td>{p.completionTokens.toLocaleString()}</td>
                    <td><strong>{p.totalTokens.toLocaleString()}</strong></td>
                    <td style={{ color: 'var(--success-color)' }}>{formatUsd(p.estimatedCostUsd)}</td>
                    <td>{p.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TOOL CALLS TABLE */}
      {breakdown && Object.keys(breakdown.toolCalls.byTool).length > 0 && (
        <div className="card" style={{ marginBottom: '32px' }}>
          <div className="card-header">
            <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={18} />
              Tool Calls por Ferramenta
            </h2>
            <div style={{ display: 'flex', gap: '16px', fontSize: '0.875rem' }}>
              <span style={{ color: 'var(--success-color)' }}>
                <CheckCircle size={14} style={{ display: 'inline', marginRight: '4px' }} />
                {breakdown.toolCalls.success} sucesso
              </span>
              {breakdown.toolCalls.error > 0 && (
                <span style={{ color: 'var(--error-color)' }}>
                  <AlertCircle size={14} style={{ display: 'inline', marginRight: '4px' }} />
                  {breakdown.toolCalls.error} erro
                </span>
              )}
            </div>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Ferramenta</th>
                  <th>Total</th>
                  <th>Sucesso</th>
                  <th>Erro</th>
                  <th>Duração Média</th>
                  <th>Taxa de Sucesso</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(breakdown.toolCalls.byTool)
                  .sort(([, a], [, b]) => b.total - a.total)
                  .map(([name, data]) => (
                  <tr key={name}>
                    <td><code style={{ fontSize: '0.8125rem' }}>{name}</code></td>
                    <td>{data.total}</td>
                    <td style={{ color: 'var(--success-color)' }}>{data.success}</td>
                    <td style={{ color: data.error > 0 ? 'var(--error-color)' : 'var(--text-secondary)' }}>
                      {data.error}
                    </td>
                    <td>{formatMs(data.avgDurationMs)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ 
                          width: '80px', 
                          height: '6px', 
                          backgroundColor: 'rgba(255, 255, 255, 0.1)',
                          borderRadius: '3px',
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            width: `${data.total > 0 ? (data.success / data.total) * 100 : 0}%`,
                            height: '100%',
                            backgroundColor: data.error > 0 ? 'var(--warning-color)' : 'var(--success-color)',
                            borderRadius: '3px',
                            transition: 'width 0.3s ease'
                          }} />
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {data.total > 0 ? ((data.success / data.total) * 100).toFixed(0) : 0}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TIMELINE */}
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
                  {log.type === 'llm' && log.payload.usage && (
                    <span style={{
                      fontSize: '0.6875rem',
                      backgroundColor: 'var(--accent-soft)',
                      color: 'var(--accent-color)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontWeight: 600,
                    }}>
                      {(log.payload.usage.totalTokens || 0).toLocaleString()} tokens
                    </span>
                  )}
                  {log.type === 'llm' && log.payload.latencyMs && (
                    <span style={{
                      fontSize: '0.6875rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      color: 'var(--text-secondary)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                    }}>
                      {formatMs(log.payload.latencyMs)}
                    </span>
                  )}
                  {log.type === 'tool' && (
                    <span style={{
                      fontSize: '0.6875rem',
                      backgroundColor: log.payload.success 
                        ? 'rgba(16, 185, 129, 0.15)' 
                        : 'rgba(239, 68, 68, 0.15)',
                      color: log.payload.success ? 'var(--success-color)' : 'var(--error-color)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontWeight: 600,
                    }}>
                      {log.payload.success ? 'SUCCESS' : 'ERROR'}
                    </span>
                  )}
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

// Need Clock icon
function Clock({ size, color }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
