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

export interface RunStats {
  startedAt: number | null
  elapsedMs: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  llmCalls: number
  lastLatencyMs: number
  backendSessionId?: string
}

const emptyRunStats = (): RunStats => ({
  startedAt: null,
  elapsedMs: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  llmCalls: 0,
  lastLatencyMs: 0
})

export function useAgent(api: any) {
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID())
  const [sessionTitle, setSessionTitle] = useState<string>('Nova Conversa')
  const [messages, setMessages] = useState<Message[]>([])
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [thinking, setThinking] = useState<string | null>(null)
  const [runStats, setRunStats] = useState<RunStats>(() => emptyRunStats())

  // Refs for latest state in event callbacks
  const stateRef = useRef({ messages, toolCalls, sessionId, sessionTitle, runStats })
  useEffect(() => {
    stateRef.current = { messages, toolCalls, sessionId, sessionTitle, runStats }
  }, [messages, toolCalls, sessionId, sessionTitle, runStats])

  useEffect(() => {
    if (!isRunning || !stateRef.current.runStats.startedAt) return

    const interval = window.setInterval(() => {
      const startedAt = stateRef.current.runStats.startedAt
      if (!startedAt) return
      setRunStats((prev) => ({ ...prev, elapsedMs: Date.now() - startedAt }))
    }, 1000)

    return () => window.clearInterval(interval)
  }, [isRunning])

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
          const newMsgs = [...stateRef.current.messages, assistantMsg]
          stateRef.current.messages = newMsgs
          setMessages(newMsgs)
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
              toolCalls: currentCalls,
              runStats: stateRef.current.runStats
            })
          }
        }
      } else if (event.type === 'thinking') {
        setThinking(event.content)
      } else if (event.type === 'tool_call') {
        try {
          const parsed = typeof event.content === 'string' ? JSON.parse(event.content) : event.content
          const newCalls = [...stateRef.current.toolCalls, {
            id: crypto.randomUUID(),
            tool: parsed.tool || 'unknown_tool',
            args: parsed.arguments || {},
            status: 'pending' as const,
            timestamp: Date.now()
          }]
          stateRef.current.toolCalls = newCalls
          setToolCalls(newCalls)
        } catch (e) {
          // fallback
          const newCalls = [...stateRef.current.toolCalls, {
            id: crypto.randomUUID(),
            tool: 'tool_call',
            args: { raw: event.content },
            status: 'pending' as const,
            timestamp: Date.now()
          }]
          stateRef.current.toolCalls = newCalls
          setToolCalls(newCalls)
        }
      } else if (event.type === 'tool_result') {
         let parsedResult: any = event.content
         try {
           const parsed = typeof event.content === 'string' ? JSON.parse(event.content) : event.content
           parsedResult = parsed?.result ?? parsed
         } catch {
           parsedResult = event.content
         }
         // Update the last pending tool call
         const newCalls = [...stateRef.current.toolCalls]
         const lastPendingIndex = newCalls.map(c => c.status).lastIndexOf('pending')
         if (lastPendingIndex >= 0) {
           newCalls[lastPendingIndex] = {
             ...newCalls[lastPendingIndex],
             status: parsedResult?.error ? 'error' : 'success',
             result: parsedResult
           }
         }
         stateRef.current.toolCalls = newCalls
         setToolCalls(newCalls)
      } else if (event.type === 'llm') {
        const usage = event.metadata?.usage ?? {}
        const promptTokens = Number(usage.promptTokens ?? usage.inputTokens ?? 0)
        const completionTokens = Number(usage.completionTokens ?? usage.outputTokens ?? 0)
        const totalTokens = Number(usage.totalTokens ?? promptTokens + completionTokens)
        const lastLatencyMs = Number(event.metadata?.latencyMs ?? 0)

        setRunStats((prev) => {
          const next = {
            ...prev,
            promptTokens: prev.promptTokens + promptTokens,
            completionTokens: prev.completionTokens + completionTokens,
            totalTokens: prev.totalTokens + totalTokens,
            llmCalls: prev.llmCalls + 1,
            lastLatencyMs
          }
          stateRef.current.runStats = next
          return next
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

    const newMsgs = [...stateRef.current.messages, userMsg]
    stateRef.current.messages = newMsgs
    const nextStats: RunStats = {
      ...emptyRunStats(),
      startedAt: Date.now(),
      promptTokens: estimatePromptTokens(task)
    }
    stateRef.current.runStats = nextStats

    // Set title on first message
    if (newMsgs.length === 1) {
      const title = task.slice(0, 40) + (task.length > 40 ? '...' : '')
      stateRef.current.sessionTitle = title
      setSessionTitle(title)
    }
    
    setMessages(newMsgs)
    setRunStats(nextStats)
    
    // Do NOT clear toolCalls if we are continuing a conversation
    setThinking(null)
    setIsRunning(true)

    api.saveHistorySession({
      id: stateRef.current.sessionId,
      title: stateRef.current.sessionTitle,
      timestamp: Date.now(),
      messages: newMsgs,
      toolCalls: stateRef.current.toolCalls,
      runStats: nextStats
    })

    try {
      const response = await api.runAgent(task)
      if (!response.success) {
        throw new Error(response.error || 'Failed to start agent')
      }
      if (response.sessionId) {
        setRunStats((prev) => {
          const next = { ...prev, backendSessionId: response.sessionId }
          stateRef.current.runStats = next
          return next
        })
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
      setRunStats((prev) => ({ ...prev, elapsedMs: prev.startedAt ? Date.now() - prev.startedAt : prev.elapsedMs }))
    }
  }, [api])

  const stopAgent = useCallback(async () => {
    await api.stopAgent()
    setIsRunning(false)
    setThinking(null)
    setRunStats((prev) => ({ ...prev, elapsedMs: prev.startedAt ? Date.now() - prev.startedAt : prev.elapsedMs }))
  }, [api])

  const startNewSession = useCallback(() => {
    setSessionId(crypto.randomUUID())
    setSessionTitle('Nova Conversa')
    setMessages([])
    setToolCalls([])
    setThinking(null)
    setIsRunning(false)
    setRunStats(emptyRunStats())
  }, [])

  const loadSession = useCallback((session: any) => {
    setSessionId(session.id)
    setSessionTitle(session.title || 'Conversa Salva')
    setMessages(session.messages || [])
    setToolCalls(session.toolCalls || [])
    setThinking(null)
    setIsRunning(false)
    setRunStats(session.runStats || emptyRunStats())
  }, [])

  return {
    messages,
    toolCalls,
    isRunning,
    thinking,
    runStats,
    runAgent,
    stopAgent,
    startNewSession,
    loadSession
  }
}

function estimatePromptTokens(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return Math.max(1, Math.ceil(trimmed.length / 4))
}
