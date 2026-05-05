import { useRef, useEffect, useCallback, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Message } from '../hooks/useAgent'

interface ChatPanelProps {
  messages: Message[]
  isRunning: boolean
  thinking: string | null
  onSend: (text: string) => void
  onStop: () => void
}

export function ChatPanel({ messages, isRunning, thinking, onSend, onStop }: ChatPanelProps): React.JSX.Element {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = '24px'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || isRunning) return

    onSend(text)
    setInput('')

    if (inputRef.current) {
      inputRef.current.style.height = '24px'
    }
  }, [input, isRunning, onSend])

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
    <div className="chat-container">
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
        
        {thinking && (
          <div className="message message--assistant message--thinking">
            <div className="message__avatar">⬡</div>
            <div className="message__content">
              <em>{thinking}</em>
            </div>
          </div>
        )}

        {isRunning && !thinking && (
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
              onClick={onStop}
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
