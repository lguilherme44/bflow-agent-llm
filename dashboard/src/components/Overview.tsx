import { 
  AreaChart,
  Area,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';
import { StatsCard } from './StatsCard';
import { Users, Target, Zap, AlertTriangle } from 'lucide-react';

interface Stats {
  totalSessions: number;
  successRate: number;
  errorRate: number;
  totalTokens: number;
}

interface SessionMetadata {
  id: string;
  tokenUsage: number;
}

interface OverviewProps {
  stats: Stats | null;
  sessions: SessionMetadata[];
}

export function Overview({ stats, sessions }: OverviewProps) {
  const chartData = sessions.slice(0, 10).reverse().map(s => ({
    name: s.id.slice(0, 8),
    tokens: s.tokenUsage,
  }));

  return (
    <div className="animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Bem-vindo ao centro de comando do seu agente.</p>
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
      </div>

      <div className="card" style={{ marginTop: '32px' }}>
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
                animationDuration={1500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
