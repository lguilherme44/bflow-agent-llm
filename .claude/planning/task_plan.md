# Task Plan — Dashboard + RAG + Context Compression

**Goal:** Melhorar observabilidade (dashboard), qualidade do RAG, e compressão de contexto no bflow-agent-llm.

**Branch:** `develop`

---

## Phase 1: Dashboard — Token Breakdown + Custo + Erro/Sucesso [P1]

**Status:** `complete` ✅

### 1.1 Backend: Estender SessionMetadata e DashboardService
- [ ] Adicionar `promptTokens`, `completionTokens`, `costUsd`, `avgLatencyMs` ao `SessionMetadata`
- [ ] Adicionar `providerBreakdown` (tokens por provider)
- [ ] Calcular custo estimado nos endpoints `/api/metrics` e `/api/sessions`
- [ ] Adicionar endpoint `/api/sessions/:id/breakdown` com quebra de tokens por tool call

### 1.2 Frontend: Overview
- [ ] Adicionar card de custo estimado (USD)
- [ ] Adicionar card de latência média
- [ ] Adicionar gráfico de consumo por provider

### 1.3 Frontend: SessionDetail
- [ ] Painel de resumo: tokens prompt vs completion, custo, latência
- [ ] Agregação de erros/sucessos por tool call
- [ ] Timeline com badges de token usage por evento

### 1.4 Frontend: SessionList
- [ ] Adicionar colunas: custo, latência, provider
- [ ] Adicionar filtros por status

### 1.5 Logger: Garantir dados para tracking
- [ ] Verificar que `logLLMResponse` captura provider e model
- [ ] Adicionar `toolCallId` nos logs de LLM para correlacionar

### Validation
- [ ] `npm run typecheck` passa
- [ ] `npm run build` passa
- [ ] Testes passam

---

## Phase 2: Integrar RAG no Orchestrator + Threshold [P2]

**Status:** `in_progress`

### 2.1 Integração
- [ ] Chamar `retrieve_context` antes da fase de Research
- [ ] Passar resultados do RAG como contexto adicional

### 2.2 Threshold de Relevância
- [ ] Filtrar resultados com score abaixo de threshold
- [ ] Adicionar reranking via LLM (modelo pequeno)

---

## Phase 3: Context Compression Inteligente [P3]

**Status:** `in_progress`

### 3.1 Compressão Semântica
- [ ] Implementar compressor que identifica fatos redundantes
- [ ] Extrair decisões e constraints do histórico
- [ ] Sumarizar tool results antigos com LLM pequeno

### 3.2 Polar Code / Turbo Quant Style
- [ ] Pesquisar abordagem de quantização de contexto
- [ ] Implementar chunked compression com priorização

---

## Phase 4: Ollama Embeddings como Default [P4]

**Status:** `pending`

### 4.1 Trocar TF-IDF por Ollama
- [ ] Fazer OllamaEmbeddingProvider o default quando Ollama disponível
- [ ] Fallback para TF-IDF quando não disponível

---

## Phase 5: Dashboard Avançado [P5]

**Status:** `pending`

### 5.1 Novos componentes
- [ ] Filtros avançados no SessionList
- [ ] Provider breakdown chart
- [ ] RAG hit rate metrics

---

## Errors Encountered

_(none yet)_
