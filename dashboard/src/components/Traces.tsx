import { useState, useEffect } from 'react';
import { Activity, RefreshCcw, Search } from 'lucide-react';

interface Trace {
  name: string;
  duration: [number, number];
  context: {
    traceId: string;
  };
  attributes: Record<string, any>;
}

const API_BASE = '/api';

export function Traces() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchTraces();
  }, []);

  const fetchTraces = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/traces`);
      const data = await res.json();
      setTraces(data);
    } catch (err) {
      console.error('Error fetching traces:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in">
       <header className="page-header">
        <div>
          <h1 className="page-title">Telemetria</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Rastreamento de performance via OpenTelemetry.</p>
        </div>
        <button 
          onClick={fetchTraces} 
          className="btn btn-primary"
          disabled={loading}
        >
          <RefreshCcw size={18} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </header>

      <div className="card" style={{ marginTop: '32px' }}>
        <div className="card-header">
          <h2 className="card-title">Spans de Execução</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
             <div style={{ 
               display: 'flex', 
               alignItems: 'center', 
               gap: '8px', 
               backgroundColor: 'rgba(255, 255, 255, 0.05)',
               padding: '6px 12px',
               borderRadius: '8px',
               border: '1px solid var(--border-color)'
             }}>
                <Search size={14} color="var(--text-secondary)" />
                <input 
                  type="text" 
                  placeholder="Filtrar spans..." 
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: 'white', 
                    fontSize: '0.8125rem',
                    outline: 'none'
                  }} 
                />
             </div>
          </div>
        </div>
        <div className="log-viewer">
          {traces.slice().reverse().map((span, i) => (
            <div key={i} className="log-entry" style={{ borderLeftColor: 'var(--accent-color)' }}>
               <div className="log-meta">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Activity size={14} color="var(--accent-color)" />
                    <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{span.name}</div>
                  </div>
                  <div style={{ 
                    fontWeight: 600, 
                    color: 'var(--accent-color)',
                    backgroundColor: 'var(--accent-soft)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem'
                  }}>
                    {span.duration ? `${(span.duration[1] / 1000000).toFixed(2)}ms` : '0ms'}
                  </div>
               </div>
               <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', display: 'flex', gap: '16px' }}>
                  <span>Componente: <strong style={{ color: 'var(--text-primary)' }}>{span.attributes?.component || 'unknown'}</strong></span>
                  <span>TraceID: <code style={{ color: 'var(--accent-hover)' }}>{span.context?.traceId.slice(0, 8)}...</code></span>
               </div>
               <div className="log-payload" style={{ fontSize: '0.8125rem' }}>
                  {JSON.stringify(span.attributes, null, 2)}
               </div>
            </div>
          ))}
          {traces.length === 0 && !loading && (
            <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Nenhum dado de telemetria disponível.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
