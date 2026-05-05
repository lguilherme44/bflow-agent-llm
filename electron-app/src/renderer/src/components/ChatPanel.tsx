import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

interface ChatPanelProps {
  api: any
}

export function ChatPanel({ api }: ChatPanelProps): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
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
         console.log('Thinking:', event.content)
      } else if (event.type === 'tool_call') {
         console.log('Tool call:', event.content)
      }
    })

    return cleanup
  }, [api])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = '24px'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [])

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

    if (inputRef.current) {
      inputRef.current.style.height = '24px'
    }

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
  }, [input, isRunning, api])

  const handleStop = useCallback(async () => {
    await api.stopAgent();
    setIsRunning(false);
  }, [api]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  return (
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
                {msg.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content.split('\n').map((line, i) => (
                    <span key={i}>
                      {line}
                      {i < msg.content.split('\n').length - 1 && <br />}
                    </span>
                  ))
                )}
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
          {isRunning ? (
            <button
              className="chat-input__send chat-input__send--stop"
              onClick={handleStop}
              title="Parar Execução"
            >
              ◼
            </button>
          ) : (
            <button
              className="chat-input__send"
              onClick={handleSend}
              disabled={!input.trim() || isRunning}
              title="Enviar (Enter)"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
