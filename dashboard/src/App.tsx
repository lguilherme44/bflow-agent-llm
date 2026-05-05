import { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { Overview } from './components/Overview';
import { SessionList } from './components/SessionList';
import { SessionDetail } from './components/SessionDetail';
import { Traces } from './components/Traces';

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
  prompt?: string;
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
  prompt?: string;
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

const WS_URL = ((import.meta as any).env?.VITE_BFLOW_WS_URL as string | undefined) ?? 'ws://localhost:3030';

function App() {
  const wsRef = useRef<WebSocket | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'sessions' | 'traces'>('overview');
  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionLogs, setSessionLogs] = useState<LogEntry[]>([]);
  const [sessionBreakdown, setSessionBreakdown] = useState<SessionBreakdown | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const fetchData = useCallback(() => {
    send({ type: 'dashboard:get_snapshot' });
  }, [send]);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'dashboard:get_snapshot' }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'dashboard:snapshot') {
          setSessions(data.sessions || []);
          setStats(data.stats || null);
        } else if (data.type === 'dashboard:session') {
          setSessionLogs(data.logs || []);
          setSessionBreakdown(data.breakdown || null);
          setSelectedSessionId(data.sessionId || null);
        } else if (data.type === 'agent:event') {
          ws.send(JSON.stringify({ type: 'dashboard:get_snapshot' }));
        }
      } catch (e) {
        console.error('WS parse error', e);
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
    };

    const interval = setInterval(fetchData, 10000);
    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [fetchData]);

  const fetchSessionLogs = async (id: string) => {
    send({ type: 'dashboard:get_session', sessionId: id });
  };

  const clearAllLogs = async () => {
    if (window.confirm('Tem certeza que deseja apagar TODOS os logs? Esta acao e irreversivel.')) {
      send({ type: 'dashboard:clear_sessions' });
      setSessions([]);
      setStats(null);
      setSelectedSessionId(null);
      setSessionBreakdown(null);
    }
  };

  const deleteSession = async (id: string) => {
    if (window.confirm(`Deseja realmente apagar a sessao ${id.slice(0, 8)}...?`)) {
      send({ type: 'dashboard:delete_session', sessionId: id });
      setSessions((current) => current.filter((session) => session.id !== id));
      if (selectedSessionId === id) {
        setSelectedSessionId(null);
        setSessionBreakdown(null);
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
        return <SessionList sessions={sessions} onSelect={fetchSessionLogs} onDelete={deleteSession} />;
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
