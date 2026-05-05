import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Overview } from './components/Overview';
import { SessionList } from './components/SessionList';
import { SessionDetail } from './components/SessionDetail';
import { Traces } from './components/Traces';

// Types
export interface ProviderBreakdown {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  calls: number;
}

export interface SessionMetadata {
  id: string;
  startTime: string;
  lastUpdateTime: string;
  task: string;
  status: 'completed' | 'error' | 'in_progress';
  tokenUsage: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  avgLatencyMs: number;
  providerBreakdown: ProviderBreakdown[];
  toolCallCount: number;
  toolErrorCount: number;
  success: boolean;
}

interface LogEntry {
  timestamp: string;
  type: 'event' | 'llm' | 'tool' | 'command' | 'file';
  agentId?: string;
  payload: any;
}

export interface SessionBreakdown {
  sessionId: string;
  task: string;
  status: string;
  tokenUsage: { prompt: number; completion: number; total: number };
  estimatedCostUsd: number;
  avgLatencyMs: number;
  providers: ProviderBreakdown[];
  toolCalls: {
    total: number;
    success: number;
    error: number;
    byTool: Record<string, { total: number; success: number; error: number; avgDurationMs: number }>;
  };
  timeline: Array<{
    timestamp: string;
    type: string;
    tokensUsed?: number;
    toolName?: string;
    success?: boolean;
    durationMs?: number;
  }>;
}

interface Stats {
  totalSessions: number;
  successRate: number;
  errorRate: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalEstimatedCostUsd: number;
  avgLatencyMs: number;
  avgTokensPerSession: number;
}

const API_BASE = '/api';

function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'sessions' | 'traces'>('overview');
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionLogs, setSessionLogs] = useState<LogEntry[]>([]);
  const [sessionBreakdown, setSessionBreakdown] = useState<SessionBreakdown | null>(null);
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

    const ws = new WebSocket(`ws://localhost:3030`);

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
      const [logsRes, breakdownRes] = await Promise.all([
        fetch(`${API_BASE}/sessions/${id}`),
        fetch(`${API_BASE}/sessions/${id}/breakdown`)
      ]);
      const logsData = await logsRes.json();
      const breakdownData = await breakdownRes.json();
      setSessionLogs(logsData);
      setSessionBreakdown(breakdownData);
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
        setSessionBreakdown(null);
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
        if (selectedSessionId === id) {
          setSelectedSessionId(null);
          setSessionBreakdown(null);
        }
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
          breakdown={sessionBreakdown}
          onBack={() => { setSelectedSessionId(null); setSessionBreakdown(null); }}
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
          setSessionBreakdown(null);
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
