import { 
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { StatsCard } from './StatsCard';
import { Users, Target, Zap, AlertTriangle, DollarSign, Clock, Activity } from 'lucide-react';

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

interface SessionMetadata {
  id: string;
  tokenUsage: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  avgLatencyMs: number;
  providerBreakdown: Array<{ provider: string; totalTokens: number }>;
}

interface OverviewProps {
  stats: Stats | null;
  sessions: SessionMetadata[];
}

const PROVIDER_COLORS: Record<string, string> = {
  ollama: '#10b981',
  lmstudio: '#8b5cf6',
  openai: '#3b82f6',
  anthropic: '#f59e0b',
  openrouter: '#ef4444',
};

export function Overview({ stats, sessions }: OverviewProps) {
  const chartData = sessions.slice(0, 10).reverse().map(s => ({
    name: s.id.slice(0, 8),
    tokens: s.tokenUsage,
    prompt: s.promptTokens,
    completion: s.completionTokens,
  }));

  // Aggregate provider data across all sessions for pie chart
  const providerAgg = new Map<string, number>();
  for (const s of sessions) {
    for (const p of (s.providerBreakdown || [])) {
      providerAgg.set(p.provider, (providerAgg.get(p.provider) || 0) + (p.totalTokens || 0));
    }
  }
  const providerData = Array.from(providerAgg.entries()).map(([name, value]) => ({ name, value }));

  const formatUsd = (value: number) => `$${value.toFixed(4)}`;
  const formatMs = (value: number) => `${value}ms`;

  return (
    <div className="animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Centro de comando do seu agente.</p>
        </div>
      </header>

      <div className="stats-grid">
        <StatsCard 
          label="Total de Sessões" 
          value={stats?.totalSessions || 0} 
          icon={<Users size={20} />}
        />
        <StatsCard 
          label="Taxa de Sucesso" 
          value={`${stats?.successRate.toFixed(1) || 0}%`} 
          icon={<Target size={20} />}
          color="var(--success-color)"
        />
        <StatsCard 
          label="Taxa de Erro" 
          value={`${stats?.errorRate.toFixed(1) || 0}%`} 
          icon={<AlertTriangle size={20} />}
          color="var(--error-color)"
        />
        <StatsCard 
          label="Consumo Total" 
          value={(stats?.totalTokens || 0).toLocaleString()} 
          icon={<Zap size={20} />}
          color="var(--warning-color)"
        />
        <StatsCard 
          label="Custo Estimado" 
          value={stats?.totalEstimatedCostUsd !== undefined ? formatUsd(stats.totalEstimatedCostUsd) : '$0'} 
          icon={<DollarSign size={20} />}
          color="var(--success-color)"
        />
        <StatsCard 
          label="Latência Média" 
          value={stats?.avgLatencyMs ? formatMs(stats.avgLatencyMs) : 'N/A'} 
          icon={<Clock size={20} />}
          color="var(--accent-color)"
        />
        <StatsCard 
          label="Tokens/Sessão" 
          value={(stats?.avgTokensPerSession || 0).toLocaleString()} 
          icon={<Activity size={20} />}
          color="var(--accent-hover)"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '32px', marginTop: '32px' }}>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Consumo de Tokens por Sessão</h2>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Últimas 10 sessões</div>
          </div>
          <div style={{ height: '350px', padding: '32px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-color)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="var(--accent-color)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="name" 
                  stroke="var(--text-secondary)" 
                  fontSize={12} 
                  tickLine={false}
                  axisLine={false}
                  dy={10}
                />
                <YAxis 
                  stroke="var(--text-secondary)" 
                  fontSize={12} 
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => value > 1000 ? `${(value/1000).toFixed(1)}k` : value}
                />
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} opacity={0.5} />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'var(--glass-bg)', 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '12px',
                    backdropFilter: 'blur(10px)',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                  }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  cursor={{ stroke: 'var(--accent-color)', strokeWidth: 2 }}
                />
                <Area 
                  type="monotone" 
                  dataKey="tokens" 
                  stroke="var(--accent-color)" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorTokens)" 
                  name="Total Tokens"
                  animationDuration={1500}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Tokens por Provider</h2>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Todas as sessões</div>
          </div>
          <div style={{ height: '350px', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {providerData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={providerData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={110}
                    paddingAngle={4}
                    dataKey="value"
                    nameKey="name"
                    animationDuration={800}
                  >
                    {providerData.map((entry) => (
                      <Cell 
                        key={entry.name} 
                        fill={PROVIDER_COLORS[entry.name.toLowerCase()] || 'var(--accent-color)'} 
                      />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'var(--glass-bg)', 
                      border: '1px solid var(--border-color)', 
                      borderRadius: '12px',
                      backdropFilter: 'blur(10px)',
                    }}
                    formatter={(value) => typeof value === 'number' ? value.toLocaleString() : value}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p style={{ color: 'var(--text-secondary)' }}>Sem dados de provider</p>
            )}
          </div>
          {providerData.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '0 24px 16px', justifyContent: 'center' }}>
              {providerData.map(p => (
                <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
                  <div style={{ 
                    width: 10, height: 10, borderRadius: '50%', 
                    backgroundColor: PROVIDER_COLORS[p.name.toLowerCase()] || 'var(--accent-color)' 
                  }} />
                  <span style={{ color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{p.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Token Breakdown Chart */}
      <div className="card" style={{ marginTop: '32px' }}>
        <div className="card-header">
          <h2 className="card-title">Prompt vs Completion por Sessão</h2>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Últimas 10 sessões</div>
        </div>
        <div style={{ height: '300px', padding: '32px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} opacity={0.5} />
              <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false}
                tickFormatter={(value) => value > 1000 ? `${(value/1000).toFixed(1)}k` : value}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: 'var(--glass-bg)', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: '12px',
                }}
              />
              <Bar dataKey="prompt" fill="var(--accent-color)" name="Prompt" radius={[4, 4, 0, 0]} />
              <Bar dataKey="completion" fill="var(--warning-color)" name="Completion" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
