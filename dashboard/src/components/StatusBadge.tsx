import { CheckCircle2, AlertCircle, Clock } from 'lucide-react';

interface StatusBadgeProps {
  status: 'completed' | 'error' | 'in_progress';
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const getIcon = () => {
    switch (status) {
      case 'completed': return <CheckCircle2 size={14} />;
      case 'error': return <AlertCircle size={14} />;
      case 'in_progress': return <Clock size={14} />;
      default: return null;
    }
  };

  const getLabel = () => {
    switch (status) {
      case 'completed': return 'Concluído';
      case 'error': return 'Erro';
      case 'in_progress': return 'Em Progresso';
      default: return status;
    }
  };

  return (
    <span className={`status-badge status-${status}`}>
      {getIcon()}
      {getLabel()}
    </span>
  );
}
