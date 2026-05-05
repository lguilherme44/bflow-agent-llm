import React from 'react'
import { ToolCall } from '../hooks/useAgent'

interface ToolActivityPanelProps {
  toolCalls: ToolCall[]
}

export function ToolActivityPanel({ toolCalls }: ToolActivityPanelProps): React.JSX.Element {
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
                <span className="tool-card__status">
                  {call.status === 'pending' ? <span className="spinner spinner--small" /> : call.status}
                </span>
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
    </div>
  )
}
