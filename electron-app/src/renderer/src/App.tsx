import { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

// Safe API access — fallback when running outside Electron (e.g. browser preview)
const api = window.api ?? {
  loadConfig: async () => ({ provider: 'lmstudio', model: 'local-model', baseUrl: 'http://localhost:1234/v1', maxTurns: 15 }),
  saveConfig: async () => ({ success: true }),
  getWorkspace: async () => 'workspace',
  getVersion: async () => '1.0.0',
  runAgent: async (task: string) => { console.log('Mock runAgent:', task); return { success: true }; },
  stopAgent: async () => ({ success: true }),
  onAgentEvent: () => () => {}
}

function App(): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [workspace, setWorkspace] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load config and workspace on mount
  useEffect(() => {
    api.loadConfig().then(setConfig)
    api.getWorkspace().then(setWorkspace)
  }, [])

  useEffect(() => {
    // Setup event listener
    const cleanup = api.onAgentEvent((event: any) => {
      if (event.type === 'message' || event.type === 'complete' || event.type === 'error') {
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: event.type === 'error' ? 'system' : 'assistant',
          content: event.content,
          timestamp: Date.now()
        }
        setMessages((prev) => [...prev, assistantMsg])
        
        if (event.type === 'complete' || event.type === 'error') {
          setIsRunning(false)
        }
      } else if (event.type === 'thinking') {
         // Could update some specific "thinking" state, but keeping it simple for MVP
         console.log('Thinking:', event.content)
      } else if (event.type === 'tool_call') {
         console.log('Tool call:', event.content)
      }
    })

    return cleanup
  }, [])

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-resize textarea
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = '24px'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [])

  // Send message
  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isRunning) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsRunning(true)

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = '24px'
    }

    // Call agent via IPC
    try {
      const response = await api.runAgent(text)
      if (!response.success) {
        throw new Error(response.error || 'Failed to start agent')
      }
    } catch (error: any) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error: ${error.message}`,
        timestamp: Date.now()
      }
      setMessages((prev) => [...prev, errorMsg])
      setIsRunning(false)
    }
  }, [input, isRunning])

  // Handle Enter key (Shift+Enter for newline)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const modelName = (config.model as string) || 'local-model'
  const providerName = (config.provider as string) || 'lmstudio'
  const workspaceName = workspace ? workspace.split(/[\\/]/).pop() : '—'

  return (
    <div className="app">
      {/* ── Title Bar ──────────────────────────────────────── */}
      <div className="titlebar">
        <div className="titlebar__brand">
          <span className="titlebar__logo">bflow</span>
          <span className="titlebar__separator">·</span>
          <span className="titlebar__label">agent</span>
        </div>
        <div className="titlebar__status">
          <span className="badge badge--accent">{providerName}</span>
          <span className="badge">{modelName}</span>
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────────── */}
      <div className="main-content">
        <div className={`chat-messages${messages.length === 0 ? ' chat-messages--empty' : ''}`}>
          {messages.length === 0 ? (
            <div className="chat-welcome">
              <div className="chat-welcome__icon">🤖</div>
              <h1 className="chat-welcome__title">bflow agent</h1>
              <p className="chat-welcome__subtitle">
                Descreva uma tarefa de código e o agente vai pesquisar, planejar e executar.
                <br />
                Use <code>Shift+Enter</code> para nova linha.
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`message message--${msg.role}`}>
                <div className="message__avatar">
                  {msg.role === 'user' ? '▸' : '⬡'}
                </div>
                <div className="message__content">
                  {msg.content.split('\n').map((line, i) => (
                    <span key={i}>
                      {line}
                      {i < msg.content.split('\n').length - 1 && <br />}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
          {isRunning && (
            <div className="message message--assistant">
              <div className="message__avatar">⬡</div>
              <div className="message__content">
                <span className="spinner" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Chat Input ──────────────────────────────────── */}
        <div className="chat-input">
          <div className="chat-input__wrapper">
            <textarea
              ref={inputRef}
              className="chat-input__field"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Descreva a tarefa e pressione Enter…"
              rows={1}
              disabled={isRunning}
            />
            <button
              className="chat-input__send"
              onClick={handleSend}
              disabled={!input.trim() || isRunning}
              title="Enviar (Enter)"
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      {/* ── Status Bar ────────────────────────────────────── */}
      <div className="statusbar">
        <div className="statusbar__section">
          <div className="statusbar__item">
            <span className="statusbar__dot" />
            <span>Pronto</span>
          </div>
          <div className="statusbar__item">
            <span>📂 {workspaceName}</span>
          </div>
        </div>
        <div className="statusbar__section">
          <div className="statusbar__item">
            <span>⬡ 0 tokens</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
