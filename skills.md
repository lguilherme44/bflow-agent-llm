# Skills & Convenções do Projeto (skills.md)

Este documento define as diretrizes e convenções que o agente deve seguir ao trabalhar nesta codebase. **Leia este documento no início de cada sessão.**

## 1. Stack Tecnológica

### Agente (bflow-agent-llm)
- **Linguagem**: TypeScript (Strict Mode, NodeNext)
- **Runtime**: Node.js 22+ (ESM)
- **LLMs**: GPT-4o, Claude 3.5 Sonnet, Ollama (local), LM Studio (local), OpenRouter
- **AST/Parsing**: Tree-sitter, ast-grep, TypeScript Language Service
- **Vector DB**: LanceDB (embedded, in-process)
- **Busca Lexical**: Lunr (BM25)
- **Observabilidade**: OpenTelemetry + Tracing, JSONL logs estruturados
- **MCP**: Model Context Protocol (client + server)
- **TUI**: Ink (React para terminal)

### SaaS (bflowbarber-app)
- **Frontend**: React 18+ com TypeScript, Vite, Mantine UI
- **Gerenciamento de Estado**: TanStack Query (server state), React Context (auth/tema)
- **Comunicação em Tempo Real**: Socket.io (Web Chat)
- **Ícones**: Tabler Icons
- **Backend API**: Node.js com Express/Zod
- **Autenticação**: JWT + RBAC + Feature Flags

## 2. Padrões de Código

### TypeScript
- **AST-First**: Nunca use regex/manipulação de string para editar código quando houver parser ou language server
- **Tipagem**: Use tipos/interfaces explícitos. Evite `any`. Prefira `unknown` e type narrowing
- **Imutabilidade**: Estado do agente é imutável (AgentStateMachine retorna novo estado)
- **Errors**: Erros devem ser `ToolResult` com `errorCode`, `recoverable`, e `nextActionHint`

### React (SaaS)
- **Componentes**: Functional components com hooks. Sem class components
- **Estado de carregamento**: Todo componente com fetch deve ter `isLoading`, `isError`, `data`
- **Cache**: Use `useQuery` / `useMutation` do TanStack Query. Não faça fetch manual com useEffect
- **Rotas protegidas**: `PrivateRoute` (auth) + `RequirePermission` (RBAC) + `RequireFeature` (feature flags)
- **Páginas**: `src/pages/` contém módulos principais (Dashboard, Clientes, Agendamentos, Chat, WebChat)

## 3. Fluxo de Trabalho do Agente

### Pipeline Principal
1. **Intent Classification**: Classifica como CHAT, DIRECT, ou TASK
2. **RAG Pre-load**: Indexa workspace e busca contexto relevante (LanceDB + Lunr)
3. **Research**: ResearchAgent explora código com `retrieve_context`, `list_files`, `read_file`
4. **Planning**: PlanningAgent gera ExecutionPlan com streams paralelos
5. **Safety Lock**: Ponto de aprovação humana antes da execução
6. **Execution**: Orchestrator delega streams para sub-agentes especializados
7. **Feedback Loop**: Até 3 tentativas de recovery (debug → coder → reviewer)
8. **Git**: Branch `agent/task-<id>` criada automaticamente, merge ao finalizar

### Tool Budgets por Agente
| Role | Max Calls | Max Tokens | Max Custo |
|------|-----------|------------|-----------|
| researcher | 20 | 50k | $0.25 |
| planner | 15 | 30k | $0.15 |
| coder | 50 | 100k | $0.50 |
| reviewer | 20 | 40k | $0.20 |
| tester | 30 | 60k | $0.30 |
| debug | 25 | 50k | $0.25 |
| docs | 15 | 25k | $0.10 |
| orchestrator | 10 | 20k | $0.10 |

## 4. Segurança e Guardrails

- **RiskPolicyEngine**: Classifica tool calls como low/medium/high/blocked
- **Whitelist**: Apenas comandos permitidos em `executeCommand`
- **Denylist**: `rm -rf /`, `format`, `del /s`, `drop database`
- **Secrets**: Redação automática via `redactSecrets()`. Nunca expor em logs
- **Sandbox**: Docker (preferido) ou Native (fallback). Network desabilitado por padrão
- **Paths**: Bloqueado acesso fora do workspace. `.env`, secrets, chaves privadas protegidas
- **HITL**: Obrigatório para: comandos destrutivos, instalação de dependências, escrita em arquivos sensíveis
- **Rate Limit**: Máximo 3 chamadas LLM simultâneas (fila com slot acquisition)

## 5. Convenções de Git

- **Branches**: `agent/task-<uuid8>` (automáticas) ou `feature/agent-<task>` (manuais)
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `refactor:`
- **Merge**: `--no-ff` para manter histórico. Merge automático ao finalizar task com sucesso
- **Co-Authored-By**: `MoClaw <noreply@moclaw.ai>` nos commits do agente

## 6. Estrutura do Projeto

```
bflow-agent-llm/
├── src/
│   ├── agent/          # Orchestrator, ReActAgent, Research, Planning, Feedback
│   ├── cli/            # CLI interativa (chat, init, connect)
│   ├── code/           # Tools de código: Tree-sitter, ast-grep, TS LS, Sandbox
│   ├── context/        # ContextManager com compressão inteligente
│   ├── llm/            # Router multi-provider, adapters, redaction
│   ├── mcp/            # MCP Client manager
│   ├── observability/  # OpenTelemetry, Logger, DashboardService
│   ├── prompts/        # System prompts por papel
│   ├── rag/            # LanceDB, Lunr, embeddings (TF-IDF/Ollama)
│   ├── state/          # State machine, Checkpoint, Experience
│   ├── tests/          # Testes unitários e de integração
│   ├── tools/          # Tool registry, executor, schemas
│   ├── types/          # Tipos compartilhados
│   └── utils/          # JSON, env, config, risk-engine
├── dashboard/          # Dashboard React (Vite + Recharts)
├── mcp-server/         # MCP Server do SaaS
├── skills.md           # Este arquivo
└── TODO.md             # Roadmap de desenvolvimento
```

## 7. API do SaaS (bflowbarber-app)

### Módulos Principais
- **Clientes** (`/api/clients`): CRUD com busca, paginação, histórico de agendamentos
- **Agendamentos** (`/api/appointments`): CRUD com filtros por data, status, barbeiro
- **Serviços** (`/api/services`): Catálogo de serviços (corte, barba, etc.) com preços
- **Barbeiros** (`/api/barbers`): Profissionais com horários e especialidades
- **Dashboard** (`/api/dashboard/stats`): Faturamento, agendamentos, clientes novos
- **Chat** (`/chat`, `/web-chat`): WhatsApp + Web Chat com Socket.io

### Padrões de API
- **Validação**: Zod schemas em `src/api/routes`
- **Autenticação**: Header `Authorization: Bearer <jwt>`
- **Paginação**: Query params `page` e `limit` (default 20)
- **Erros**: `{ error: string, code: string }` com HTTP status apropriado

### Permissões (RBAC)
- `admin`: Acesso total
- `barber`: Ver agenda, confirmar/cancelar agendamentos
- `receptionist`: CRUD clientes, gerenciar agendamentos

## 8. Convenções de Teste

- **Framework**: Node.js built-in test runner (`node --test`)
- **Unitários**: `src/tests/*.test.ts`
- **Mocks**: `MockLLMAdapter` para simular respostas LLM
- **RAG**: Benchmark com queries conhecidas, Hit@5 mínimo de 60%
- **Regressão**: `quality-benchmark.test.ts` mede latência, compressão, snapshot
- **Eval**: `src/eval/harness.ts` com smoke suite e full suite

## 9. Observabilidade e Debug

- **Logs**: `.agent/logs/<session-id>.jsonl` — estruturado, redigido
- **Traces**: OpenTelemetry spans por agent run, LLM call, tool call
- **Dashboard**: `http://localhost:3030/dashboard` — visão geral, sessões, traces
- **Métricas**: `GET /api/metrics` — totalSessions, successRate, errorRate, totalTokens, cost
- **Session Breakdown**: `GET /api/sessions/:id/breakdown` — tokens por provider, tool calls, timeline

## 10. Configuração

```env
# LLM Principal
AGENT_LLM_PROVIDER=ollama          # ollama | openai | anthropic | openrouter | lmstudio
AGENT_LLM_MODEL=qwen2.5-coder      # Modelo padrão
AGENT_LLM_BASE_URL=http://localhost:11434

# Embeddings (RAG)
EMBEDDING_PROVIDER=auto            # auto | ollama | tf-idf
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_BASE_URL=http://127.0.0.1:11434

# Servidor
AGENT_SERVER_PORT=3030

# MCP Server (SaaS)
SAAS_API_URL=http://localhost:3001
SAAS_API_KEY=your-service-token
```

## 11. Troubleshooting

| Problema | Causa provável | Solução |
|----------|---------------|---------|
| "LIMITE DE CONTEXTO ATINGIDO" | `n_ctx` do modelo < tokens do prompt | Aumentar `n_ctx` no LM Studio ou Ollama |
| RAG retorna 0 resultados | Workspace não indexado | Rodar `npm run dev chat` e executar tarefa |
| Dashboard vazio | Sem logs ainda | Executar pelo menos uma task via agente |
| Budget exceeded | Agente gastando tokens demais | Verificar system prompt, aumentar budget no `DEFAULT_TOOL_BUDGETS` |
| Docker não detectado | Docker Desktop não instalado | Fallback automático para NativeSandbox |
