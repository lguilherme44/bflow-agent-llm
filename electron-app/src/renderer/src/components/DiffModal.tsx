import React from 'react'
import ReactDiffViewer from 'react-diff-viewer-continued'

interface DiffModalProps {
  isOpen: boolean
  onClose: () => void
  oldValue: string
  newValue: string
  filepath: string
}

export function DiffModal({ isOpen, onClose, oldValue, newValue, filepath }: DiffModalProps): React.JSX.Element | null {
  if (!isOpen) return null

  return (
    <div className="modal-overlay">
      <div className="modal-content modal-content--large">
        <div className="modal-header">
          <h3>Visualizando Alterações: <code>{filepath}</code></h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ background: '#1e1e1e' }}>
          <ReactDiffViewer
            oldValue={oldValue}
            newValue={newValue}
            splitView={true}
            useDarkTheme={true}
            leftTitle="Original"
            rightTitle="Modificado"
          />
        </div>
      </div>
    </div>
  )
}
