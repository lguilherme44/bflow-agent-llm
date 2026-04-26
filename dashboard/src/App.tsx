import { useState, useEffect } from 'react';
import { 
  Activity, 
  LayoutDashboard, 
  List, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  ChevronRight,
  Terminal,
  Zap,
  Cpu
} from 'lucide-react';
import { 
  AreaChart,
  Area,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';

// Types
interface SessionMetadata {
  id: string;
  startTime: string;
  lastUpdateTime: string;
  task: string;
  status: 'completed' | 'error' | 'in_progress';
  tokenUsage: number;
  success: boolean;
}

interface LogEntry {
  timestamp: string;
  type: 'event' | 'llm' | 'tool' | 'command' | 'file';
  agentId?: string;
  payload: any;
}

interface Stats {
  totalSessions: number;
  successRate: number;
  errorRate: number;
  totalTokens: number;
}

const API_BASE = '/api';

function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'sessions' | 'traces'>('overview');
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionLogs, setSessionLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // Poll less frequently now

    // WebSocket for real-time updates
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'agent_update') {
        console.log('Real-time update:', data.event);
        // Refresh sessions list if it's a phase change or complete
        if (['phase_start', 'phase_complete', 'error'].includes(data.event.type)) {
          fetchData();
        }
        
        // If we are viewing a session, we might want to append to local logs
        // (This is a simplified approach, full implementation would append to state)
      }
    };

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, []);

  const fetchData = async () => {
    try {
      const [sessionsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/sessions`),
        fetch(`${API_BASE}/metrics`)
      ]);
      const sessionsData = await sessionsRes.json();
      const statsData = await statsRes.json();
      setSessions(sessionsData);
      setStats(statsData);
    } catch (err) {
      console.error('Error fetching data:', err);
    }
  };

  const fetchSessionLogs = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/sessions/${id}`);
      const data = await res.json();
      setSessionLogs(data);
      setSelectedSessionId(id);
    } catch (err) {
      console.error('Error fetching logs:', err);
    }
  };

  const clearAllLogs = async () => {
    if (window.confirm('Tem certeza que deseja apagar TODOS os logs?')) {
      try {
        await fetch(`${API_BASE}/sessions`, { method: 'DELETE' });
        setSessions([]);
        setStats(null);
      } catch (err) {
        console.error('Error clearing logs:', err);
      }
    }
  };

  const deleteSession = async (id: string) => {
    if (window.confirm(`Apagar sessão ${id}?`)) {
      try {
        await fetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE' });
        setSessions(sessions.filter(s => s.id !== id));
        if (selectedSessionId === id) setSelectedSessionId(null);
      } catch (err) {
        console.error('Error deleting session:', err);
      }
    }
  };

  return (
    <div className="dashboard-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <Cpu className="text-blue-500" />
            <span>Agent<span style={{color: 'var(--accent-color)'}}>OS</span></span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div 
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => { setActiveTab('overview'); setSelectedSessionId(null); }}
          >
            <LayoutDashboard size={20} />
            <span>Visão Geral</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveTab('sessions')}
          >
            <List size={20} />
            <span>Sessões</span>
          </div>
          <div 
            className={`nav-item ${activeTab === 'traces' ? 'active' : ''}`}
            onClick={() => setActiveTab('traces')}
          >
            <Activity size={20} />
            <span>Observabilidade</span>
          </div>
        </nav>
        
        <div style={{padding: '20px', marginTop: 'auto'}}>
          <button 
            onClick={clearAllLogs}
            className="nav-item" 
            style={{
              width: '100%', 
              border: '1px solid var(--error-color)', 
              color: 'var(--error-color)',
              background: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            <AlertCircle size={16} />
            <span>Limpar Logs</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {selectedSessionId ? (
          <SessionDetail 
            sessionId={selectedSessionId} 
            logs={sessionLogs} 
            onBack={() => setSelectedSessionId(null)}
            onDelete={() => deleteSession(selectedSessionId)}
          />
        ) : activeTab === 'overview' ? (
          <Overview stats={stats} sessions={sessions} />
        ) : activeTab === 'sessions' ? (
          <SessionList sessions={sessions} onSelect={fetchSessionLogs} onDelete={deleteSession} />
        ) : (
          <Traces />
        )}
      </main>
    </div>
  );
}

function Overview({ stats, sessions }: { stats: Stats | null, sessions: SessionMetadata[] }) {
  const chartData = sessions.slice(0, 10).reverse().map(s => ({
    name: s.id.slice(0, 8),
    tokens: s.tokenUsage,
  }));

  return (
    <div className="animate-fade-in">
      <header className="page-header">
        <h1 className="page-title">Dashboard de Observabilidade</h1>
        <div className="stat-label">Atualizado há poucos segundos</div>
      </header>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total de Sessões</div>
          <div className="stat-value">{stats?.totalSessions || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Taxa de Sucesso</div>
          <div className="stat-value" style={{color: 'var(--success-color)'}}>
            {stats?.successRate.toFixed(1) || 0}%
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Taxa de Erro</div>
          <div className="stat-value" style={{color: 'var(--error-color)'}}>
            {stats?.errorRate.toFixed(1) || 0}%
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total de Tokens</div>
          <div className="stat-value">{stats?.totalTokens.toLocaleString() || 0}</div>
        </div>
      </div>

      <div className="card" style={{marginTop: '32px'}}>
        <div className="card-header">
          <h2 className="card-title">Consumo de Tokens por Sessão</h2>
        </div>
        <div style={{height: '300px', padding: '24px'}}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-color)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--accent-color)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={12} />
              <YAxis stroke="var(--text-secondary)" fontSize={12} />
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <Tooltip 
                contentStyle={{backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '8px'}}
                itemStyle={{color: 'var(--text-primary)'}}
              />
              <Area type="monotone" dataKey="tokens" stroke="var(--accent-color)" fillOpacity={1} fill="url(#colorTokens)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function SessionList({ sessions, onSelect, onDelete }: { 
  sessions: SessionMetadata[], 
  onSelect: (id: string) => void,
  onDelete: (id: string) => void
}) {
  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <h2 className="card-title">Sessões do Agente</h2>
      </div>
      <div style={{overflowX: 'auto'}}>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Tarefa</th>
              <th>ID da Sessão</th>
              <th>Início</th>
              <th>Tokens</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id} onClick={() => onSelect(s.id)} style={{cursor: 'pointer'}}>
                <td>
                  <span className={`status-badge status-${s.status}`}>
                    {s.status === 'completed' ? <CheckCircle2 size={12} style={{marginRight: '4px'}} /> : 
                     s.status === 'error' ? <AlertCircle size={12} style={{marginRight: '4px'}} /> : 
                     <Clock size={12} style={{marginRight: '4px'}} />}
                    {s.status}
                  </span>
                </td>
                <td style={{maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                  {s.task}
                </td>
                <td style={{fontFamily: 'monospace', color: 'var(--text-secondary)'}}>{s.id.slice(0, 12)}...</td>
                <td style={{color: 'var(--text-secondary)'}}>{new Date(s.startTime).toLocaleString('pt-BR')}</td>
                <td>{s.tokenUsage.toLocaleString()}</td>
                <td>
                  <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                    <button 
                      onClick={(e) => { e.stopPropagation(); onDelete(s.id); }}
                      style={{background: 'none', border: 'none', color: 'var(--error-color)', cursor: 'pointer', padding: '4px'}}
                    >
                      <AlertCircle size={16} />
                    </button>
                    <ChevronRight size={16} color="var(--text-secondary)" />
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

function SessionDetail({ sessionId, logs, onBack, onDelete }: { 
  sessionId: string, 
  logs: LogEntry[], 
  onBack: () => void,
  onDelete: () => void
}) {
  return (
    <div className="animate-fade-in">
      <header className="page-header">
        <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
          <button onClick={onBack} className="nav-item" style={{border: 'none', background: 'none', padding: '8px'}}>
             <ChevronRight style={{transform: 'rotate(180deg)'}} />
          </button>
          <h1 className="page-title">Detalhes da Sessão</h1>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
          <div style={{fontFamily: 'monospace', color: 'var(--text-secondary)'}}>{sessionId}</div>
          <button 
            onClick={onDelete}
            style={{background: 'none', border: 'none', color: 'var(--error-color)', cursor: 'pointer', padding: '8px'}}
          >
            <AlertCircle size={20} />
          </button>
        </div>
      </header>

      <div className="log-viewer">
        {logs.map((log, i) => (
          <div key={i} className={`log-entry ${log.type}`}>
            <div className="log-meta">
              <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                {log.type === 'llm' ? <Zap size={14} color="var(--accent-color)" /> : 
                 log.type === 'tool' ? <Terminal size={14} color="var(--warning-color)" /> : 
                 <Activity size={14} />}
                <span style={{fontWeight: 600, textTransform: 'uppercase'}}>{log.type}</span>
              </div>
              <div>{new Date(log.timestamp).toLocaleTimeString()}</div>
            </div>
            {log.type === 'event' && <div style={{fontWeight: 500}}>{log.payload.event}</div>}
            <div className="log-payload">
              {JSON.stringify(log.payload, null, 2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Traces() {
  const [traces, setTraces] = useState<any[]>([]);

  useEffect(() => {
    fetchTraces();
  }, []);

  const fetchTraces = async () => {
    try {
      const res = await fetch(`${API_BASE}/traces`);
      const data = await res.json();
      setTraces(data);
    } catch (err) {
      console.error('Error fetching traces:', err);
    }
  };

  return (
    <div className="animate-fade-in">
       <header className="page-header">
        <h1 className="page-title">Traces de Observabilidade</h1>
        <button onClick={fetchTraces} className="nav-item active" style={{border: 'none', cursor: 'pointer'}}>
          Atualizar
        </button>
      </header>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Últimos Spans (OpenTelemetry)</h2>
        </div>
        <div className="log-viewer">
          {traces.slice().reverse().map((span, i) => (
            <div key={i} className="log-entry" style={{borderLeftColor: 'var(--accent-color)'}}>
               <div className="log-meta">
                  <div style={{fontWeight: 700}}>{span.name}</div>
                  <div>{span.duration ? `${(span.duration[1] / 1000000).toFixed(2)}ms` : ''}</div>
               </div>
               <div style={{fontSize: '0.8rem', color: 'var(--text-secondary)'}}>
                  Component: {span.attributes?.component} | TraceID: {span.context?.traceId}
               </div>
               <div className="log-payload">
                  {JSON.stringify(span.attributes, null, 2)}
               </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
