import React, { useMemo } from 'react'
import { ToolCall } from '../hooks/useAgent'

interface FileExplorerPanelProps {
  toolCalls: ToolCall[]
}

export function FileExplorerPanel({ toolCalls }: FileExplorerPanelProps): React.JSX.Element {
  
  const touchedFiles = useMemo(() => {
    const files = new Set<string>()
    toolCalls.forEach(call => {
      if (call.args && typeof call.args.filepath === 'string') {
        files.add(call.args.filepath)
      } else if (call.args && typeof call.args.directory === 'string') {
        // Just for reference, might not want to list directories
        // files.add(call.args.directory + '/')
      }
    })
    return Array.from(files).sort()
  }, [toolCalls])

  return (
    <div className="activity-panel">
      <div className="activity-panel__header">
        <h3>Arquivos Tocados</h3>
      </div>
      <div className="activity-panel__content">
        {touchedFiles.length === 0 ? (
          <div className="activity-panel__empty">Nenhum arquivo modificado ou lido ainda.</div>
        ) : (
          <div className="file-list">
            {touchedFiles.map(file => (
              <div key={file} className="file-list__item">
                <span className="file-list__icon">📄</span>
                <span className="file-list__name">{file}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
