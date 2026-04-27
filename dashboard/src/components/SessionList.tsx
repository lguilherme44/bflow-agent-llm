import { ChevronRight, Trash2, DollarSign, Terminal } from 'lucide-react';
import { StatusBadge } from './StatusBadge';

interface SessionMetadata {
  id: string;
  startTime: string;
  task: string;
  status: 'completed' | 'error' | 'in_progress';
  tokenUsage: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  avgLatencyMs: number;
  toolCallCount: number;
  toolErrorCount: number;
}

interface SessionListProps {
  sessions: SessionMetadata[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const formatUsd = (value: number) => value > 0.0001 ? `$${value.toFixed(4)}` : '<$0.0001';
const formatMs = (ms: number) => ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

export function SessionList({ sessions, onSelect, onDelete }: SessionListProps) {
  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <h2 className="card-title">Histórico de Sessões</h2>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{sessions.length} sessões encontradas</div>
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Tarefa</th>
              <th>ID</th>
              <th>Data</th>
              <th>Prompt</th>
              <th>Comp.</th>
              <th>Total</th>
              <th>Custo</th>
              <th>Latência</th>
              <th>Tools</th>
              <th style={{ textAlign: 'right' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id} onClick={() => onSelect(s.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td style={{ maxWidth: '200px' }}>
                  <div style={{ 
                    fontWeight: 500, 
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis' 
                  }}>
                    {s.task}
                  </div>
                </td>
                <td>
                  <code style={{ 
                    fontSize: '0.75rem', 
                    color: 'var(--text-secondary)',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}>
                    {s.id.slice(0, 8)}
                  </code>
                </td>
                <td>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                    {new Date(s.startTime).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </td>
                <td>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--accent-color)' }}>
                    {s.promptTokens.toLocaleString()}
                  </span>
                </td>
                <td>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--warning-color)' }}>
                    {s.completionTokens.toLocaleString()}
                  </span>
                </td>
                <td>
                  <span style={{ fontWeight: 600 }}>{s.tokenUsage.toLocaleString()}</span>
                </td>
                <td>
                  <span style={{ 
                    fontWeight: 600, 
                    color: s.estimatedCostUsd > 0 ? 'var(--success-color)' : 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}>
                    <DollarSign size={12} />
                    {formatUsd(s.estimatedCostUsd)}
                  </span>
                </td>
                <td>
                  <span style={{ 
                    fontSize: '0.8125rem', 
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}>
                    <Clock2 size={12} />
                    {s.avgLatencyMs > 0 ? formatMs(s.avgLatencyMs) : '-'}
                  </span>
                </td>
                <td>
                  <span style={{ 
                    fontSize: '0.8125rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: s.toolErrorCount > 0 ? 'var(--error-color)' : 'var(--text-secondary)',
                  }}>
                    <Terminal size={12} />
                    {s.toolCallCount}
                    {s.toolErrorCount > 0 && (
                      <span style={{ fontSize: '0.6875rem', opacity: 0.8 }}>
                        ({s.toolErrorCount} err)
                      </span>
                    )}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                    <button 
                      onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                      className="btn btn-ghost"
                      style={{ padding: '8px', color: 'var(--error-color)' }}
                    >
                      <Trash2 size={16} />
                    </button>
                    <ChevronRight size={18} color="var(--text-secondary)" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Clock2({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
