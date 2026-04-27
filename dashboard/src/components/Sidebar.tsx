import { 
  LayoutDashboard, 
  List, 
  Activity, 
  Trash2,
  Cpu
} from 'lucide-react';

interface SidebarProps {
  activeTab: 'overview' | 'sessions' | 'traces';
  onTabChange: (tab: 'overview' | 'sessions' | 'traces') => void;
  onClearLogs: () => void;
}

export function Sidebar({ activeTab, onTabChange, onClearLogs }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <div style={{ 
            background: 'var(--accent-color)', 
            padding: '6px', 
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 20px var(--accent-soft)'
          }}>
            <Cpu size={20} color="white" />
          </div>
          <span>Agent<span style={{ color: 'var(--accent-color)' }}>OS</span></span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div 
          className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => onTabChange('overview')}
        >
          <LayoutDashboard size={20} />
          <span>Visão Geral</span>
        </div>
        <div 
          className={`nav-item ${activeTab === 'sessions' ? 'active' : ''}`}
          onClick={() => onTabChange('sessions')}
        >
          <List size={20} />
          <span>Sessões</span>
        </div>
        <div 
          className={`nav-item ${activeTab === 'traces' ? 'active' : ''}`}
          onClick={() => onTabChange('traces')}
        >
          <Activity size={20} />
          <span>Observabilidade</span>
        </div>

        <div 
          className="nav-item danger" 
          onClick={onClearLogs}
        >
          <Trash2 size={20} />
          <span>Limpar Logs</span>
        </div>
      </nav>
    </aside>
  );
}
