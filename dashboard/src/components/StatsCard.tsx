import React from 'react';

interface StatsCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    isUp: boolean;
  };
  color?: string;
}

export function StatsCard({ label, value, icon, trend, color }: StatsCardProps) {
  return (
    <div className="stat-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="stat-label">{label}</div>
        {icon && <div style={{ color: color || 'var(--text-secondary)' }}>{icon}</div>}
      </div>
      <div className="stat-value" style={{ color: color }}>
        {value}
      </div>
      {trend && (
        <div style={{ 
          fontSize: '0.75rem', 
          fontWeight: 600, 
          color: trend.isUp ? 'var(--success-color)' : 'var(--error-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          marginTop: '4px'
        }}>
          {trend.isUp ? '↑' : '↓'} {trend.value}% 
          <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>vs último período</span>
        </div>
      )}
    </div>
  );
}
