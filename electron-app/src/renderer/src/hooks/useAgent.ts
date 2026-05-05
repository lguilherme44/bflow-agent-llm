import { useState, useEffect, useCallback, useRef } from 'react'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface ToolCall {
  id: string
  tool: string
  args: any
  status: 'pending' | 'success' | 'error'
  result?: any
  timestamp: number
}

export function useAgent(api: any) {
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID())
  const [sessionTitle, setSessionTitle] = useState<string>('Nova Conversa')
  const [messages, setMessages] = useState<Message[]>([])
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [thinking, setThinking] = useState<string | null>(null)

  // Refs for latest state in event callbacks
  const stateRef = useRef({ messages, toolCalls, sessionId, sessionTitle })
  useEffect(() => {
    stateRef.current = { messages, toolCalls, sessionId, sessionTitle }
  }, [messages, toolCalls, sessionId, sessionTitle])

  useEffect(() => {
    const cleanup = api.onAgentEvent((event: any) => {
      if (event.type === 'message' || event.type === 'complete' || event.type === 'error') {
        if (event.type === 'message' || event.type === 'error') {
          const assistantMsg: Message = {
            id: crypto.randomUUID(),
            role: event.type === 'error' ? 'system' : 'assistant',
            content: event.content,
            timestamp: Date.now()
          }
          setMessages((prev) => [...prev, assistantMsg])
        }
        
        if (event.type === 'complete' || event.type === 'error') {
          setIsRunning(false)
          setThinking(null)

          // Auto-save session
          const { sessionId, sessionTitle, messages: currentMsgs, toolCalls: currentCalls } = stateRef.current
          if (currentMsgs.length > 0) {
            api.saveHistorySession({
              id: sessionId,
              title: sessionTitle,
              timestamp: Date.now(),
              messages: currentMsgs,
              toolCalls: currentCalls
            })
          }
        }
      } else if (event.type === 'thinking') {
        setThinking(event.content)
      } else if (event.type === 'tool_call') {
        try {
          const parsed = typeof event.content === 'string' ? JSON.parse(event.content) : event.content
          setToolCalls((prev) => [...prev, {
            id: crypto.randomUUID(),
            tool: parsed.tool || 'unknown_tool',
            args: parsed.arguments || {},
            status: 'pending',
            timestamp: Date.now()
          }])
        } catch (e) {
          // fallback
          setToolCalls((prev) => [...prev, {
            id: crypto.randomUUID(),
            tool: 'tool_call',
            args: { raw: event.content },
            status: 'pending',
            timestamp: Date.now()
          }])
        }
      } else if (event.type === 'tool_result') {
         // Update the last pending tool call
         setToolCalls((prev) => {
           const newCalls = [...prev]
           const lastPendingIndex = newCalls.map(c => c.status).lastIndexOf('pending')
           if (lastPendingIndex >= 0) {
             newCalls[lastPendingIndex] = {
               ...newCalls[lastPendingIndex],
               status: 'success',
               result: event.content
             }
           }
           return newCalls
         })
      }
    })

    return cleanup
  }, [api])

  const runAgent = useCallback(async (task: string) => {
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: task,
      timestamp: Date.now()
    }

    setMessages((prev) => {
      const newMsgs = [...prev, userMsg]
      // Set title on first message
      if (newMsgs.length === 1) {
        setSessionTitle(task.slice(0, 40) + (task.length > 40 ? '...' : ''))
      }
      return newMsgs
    })
    
    // Do NOT clear toolCalls if we are continuing a conversation
    setThinking(null)
    setIsRunning(true)

    try {
      const response = await api.runAgent(task)
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
  }, [api])

  const stopAgent = useCallback(async () => {
    await api.stopAgent()
    setIsRunning(false)
    setThinking(null)
  }, [api])

  const startNewSession = useCallback(() => {
    setSessionId(crypto.randomUUID())
    setSessionTitle('Nova Conversa')
    setMessages([])
    setToolCalls([])
    setThinking(null)
    setIsRunning(false)
  }, [])

  const loadSession = useCallback((session: any) => {
    setSessionId(session.id)
    setSessionTitle(session.title || 'Conversa Salva')
    setMessages(session.messages || [])
    setToolCalls(session.toolCalls || [])
    setThinking(null)
    setIsRunning(false)
  }, [])

  return {
    messages,
    toolCalls,
    isRunning,
    thinking,
    runAgent,
    stopAgent,
    startNewSession,
    loadSession
  }
}
