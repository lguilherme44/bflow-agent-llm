import React, { useState } from 'react'
import { ToolCall } from '../hooks/useAgent'
import { DiffModal } from './DiffModal'

interface ToolActivityPanelProps {
  toolCalls: ToolCall[]
}

export function ToolActivityPanel({ toolCalls }: ToolActivityPanelProps): React.JSX.Element {
  const [diffModal, setDiffModal] = useState<{ isOpen: boolean; oldValue: string; newValue: string; filepath: string } | null>(null)

  const handleShowDiff = (call: ToolCall) => {
    // Basic extraction logic: depends on what the tool returns
    // For edit_file_ast or apply_edit_plan, it might be in result.diff or result.plan.diff
    // Since react-diff-viewer needs oldValue and newValue, and we only have a diff string...
    // Wait, if we only have a patch string from the core, react-diff-viewer might not render it correctly
    // unless we parse the patch. But react-diff-viewer can take oldValue and newValue.
    // If the core returns the actual file content before and after, we could use that.
    // For MVP, if we have result.oldContent and result.newContent:
    const oldVal = call.result?.oldContent || call.result?.plan?.oldContent || ''
    const newVal = call.result?.newContent || call.result?.plan?.newContent || call.result?.diff || ''
    const filepath = call.args?.filepath || call.result?.filepath || 'desconhecido'

    setDiffModal({ isOpen: true, oldValue: oldVal, newValue: newVal, filepath })
  }

  const hasDiff = (call: ToolCall) => {
    return call.status === 'success' && call.result && (
      call.result.diff || call.result.plan?.diff || call.result.newContent
    )
  }

  return (
    <div className="activity-panel">
      <div className="activity-panel__header">
        <h3>Tool Activity</h3>
      </div>
      <div className="activity-panel__content">
        {toolCalls.length === 0 ? (
          <div className="activity-panel__empty">Nenhuma ferramenta executada ainda.</div>
        ) : (
          toolCalls.map((call) => (
            <div key={call.id} className={`tool-card tool-card--${call.status}`}>
              <div className="tool-card__header">
                <span className="tool-card__name">{call.tool}</span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {hasDiff(call) && (
                    <button className="badge badge--accent" style={{ cursor: 'pointer', border: 'none' }} onClick={() => handleShowDiff(call)}>
                      Ver Diff
                    </button>
                  )}
                  <span className="tool-card__status">
                    {call.status === 'pending' ? <span className="spinner spinner--small" /> : call.status}
                  </span>
                </div>
              </div>
              <div className="tool-card__args">
                <pre>{JSON.stringify(call.args, null, 2)}</pre>
              </div>
              {call.result && (
                <div className="tool-card__result">
                  <pre>{typeof call.result === 'string' ? call.result.substring(0, 200) + (call.result.length > 200 ? '...' : '') : JSON.stringify(call.result).substring(0, 200)}</pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      
      {diffModal && (
        <DiffModal 
          isOpen={diffModal.isOpen} 
          onClose={() => setDiffModal(null)}
          oldValue={diffModal.oldValue}
          newValue={diffModal.newValue}
          filepath={diffModal.filepath}
        />
      )}
    </div>
  )
}
