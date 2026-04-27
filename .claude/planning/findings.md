# Findings — Dashboard + RAG + Context Compression

## Codebase Structure

### Backend (Node.js/TypeScript)
- `src/observability/dashboard-service.ts` — API de métricas e sessões
- `src/observability/logger.ts` — UnifiedLogger (JSONL)
- `src/context/manager.ts` — ContextManager (compactação de contexto)
- `src/rag/local-rag.ts` — LocalRagService (RAG com LanceDB + Lunr)
- `src/rag/lancedb-store.ts` — LanceDBStore (vector store)
- `src/rag/embeddings.ts` — TF-IDF + Ollama providers
- `src/llm/adapter.ts` — LLM adapters + MockLLMAdapter
- `src/llm/router.ts` — LLMRouter multi-provider
- `src/agent/orchestrator.ts` — OrchestratorAgent (fluxo principal)
- `src/types/index.ts` — Todos os tipos do sistema

### Frontend (React + Vite)
- `dashboard/src/App.tsx` — App principal com WebSocket
- `dashboard/src/components/Overview.tsx` — Visão geral (stats + gráfico)
- `dashboard/src/components/SessionList.tsx` — Lista de sessões
- `dashboard/src/components/SessionDetail.tsx` — Detalhe da sessão
- `dashboard/src/components/StatsCard.tsx` — Card de métrica
- `dashboard/src/components/Traces.tsx` — Telemetria OpenTelemetry

### Key Interfaces
- `SessionMetadata`: id, startTime, lastUpdateTime, task, status, tokenUsage, success
- `DashboardStats`: totalSessions, successRate, errorRate, totalTokens, avgLatencyMs
- `LogEntry`: timestamp, type (event|llm|tool|command|file), agentId, payload

## Gaps Identified

### Dashboard
1. SessionMetadata não tem promptTokens, completionTokens, costUsd, providerBreakdown
2. SessionDetail não agrega dados — só mostra timeline raw
3. Overview não mostra custo, latência, ou breakdown por provider
4. SessionList sem colunas de custo/latência

### Logger
1. logLLMResponse já captura provider e model — OK
2. Mas não correlaciona com toolCallId

### RAG
1. Não integrado ao Orchestrator.run()
2. TF-IDF padrão (fraco semanticamente)
3. Sem threshold de relevância
4. Compressão placeholder

### Context
1. Compactação ingênua (length-based)
2. Sem sumarização semântica
3. Truncamento cego
