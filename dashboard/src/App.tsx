import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Overview } from './components/Overview';
import { SessionList } from './components/SessionList';
import { SessionDetail } from './components/SessionDetail';
import { Traces } from './components/Traces';

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

  const fetchData = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'agent_update') {
          if (['phase_start', 'phase_complete', 'error'].includes(data.event.type)) {
            fetchData();
          }
        }
      } catch (e) {
        console.error('WS parse error', e);
      }
    };

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [fetchData]);

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
    if (window.confirm('Tem certeza que deseja apagar TODOS os logs? Esta ação é irreversível.')) {
      try {
        await fetch(`${API_BASE}/sessions`, { method: 'DELETE' });
        setSessions([]);
        setStats(null);
        setSelectedSessionId(null);
      } catch (err) {
        console.error('Error clearing logs:', err);
      }
    }
  };

  const deleteSession = async (id: string) => {
    if (window.confirm(`Deseja realmente apagar a sessão ${id.slice(0, 8)}...?`)) {
      try {
        await fetch(`${API_BASE}/sessions/${id}`, { method: 'DELETE' });
        setSessions(sessions.filter(s => s.id !== id));
        if (selectedSessionId === id) setSelectedSessionId(null);
      } catch (err) {
        console.error('Error deleting session:', err);
      }
    }
  };

  const renderContent = () => {
    if (selectedSessionId) {
      return (
        <SessionDetail 
          sessionId={selectedSessionId} 
          logs={sessionLogs} 
          onBack={() => setSelectedSessionId(null)}
          onDelete={() => deleteSession(selectedSessionId)}
        />
      );
    }

    switch (activeTab) {
      case 'overview':
        return <Overview stats={stats} sessions={sessions} />;
      case 'sessions':
        return (
          <SessionList 
            sessions={sessions} 
            onSelect={fetchSessionLogs} 
            onDelete={deleteSession} 
          />
        );
      case 'traces':
        return <Traces />;
      default:
        return <Overview stats={stats} sessions={sessions} />;
    }
  };

  return (
    <div className="dashboard-container">
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSelectedSessionId(null);
        }} 
        onClearLogs={clearAllLogs}
      />

      <main className="main-content">
        {renderContent()}
      </main>
    </div>
  );
}

export default App;
