import { ChevronRight, Trash2 } from 'lucide-react';
import { StatusBadge } from './StatusBadge';

interface SessionMetadata {
  id: string;
  startTime: string;
  task: string;
  status: 'completed' | 'error' | 'in_progress';
  tokenUsage: number;
}

interface SessionListProps {
  sessions: SessionMetadata[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

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
              <th>Data de Início</th>
              <th>Tokens</th>
              <th style={{ textAlign: 'right' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id} onClick={() => onSelect(s.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td style={{ maxWidth: '300px' }}>
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
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
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
                  <span style={{ fontWeight: 600 }}>{s.tokenUsage.toLocaleString()}</span>
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
