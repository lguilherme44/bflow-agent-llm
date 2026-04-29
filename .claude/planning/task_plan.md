# Task Plan — Fase 2: Tool Budget + MCP Server + DocsAgent + Snapshot + Sandbox

**Branch:** `develop`

---

## Phase A: Tool Budget por Agente + Rate Limit

**Status:** `in_progress`

### A.1 Tool Budget
- [ ] Adicionar `toolBudget` (max calls + max tokens) ao ReActConfig
- [ ] Enforce no ReActLoop: interromper quando budget esgotado
- [ ] Budget por tipo de agente (coder=50 calls, reviewer=20, etc.)

### A.2 Rate Limit para paralelismo
- [ ] Rate limiter no LLMRouter para múltiplos sub-agentes
- [ ] Evitar que N agentes chamem LLM simultaneamente sem controle

---

## Phase B: MCP Server do SaaS

**Status:** `pending`

### B.1 Criar MCP Server
- [ ] Package `mcp-server/` expondo APIs internas como tools MCP
- [ ] Tools: list_clients, get_appointments, send_message, etc.

---

## Phase C: DocsAgent + Git Integration

**Status:** `pending`

### C.1 DocsAgent
- [ ] Implementar DocsAgent que atualiza README, CHANGELOG, ADRs

### C.2 Git Integration
- [ ] Branch por feature/task
- [ ] Merge automático ao finalizar

---

## Phase D: Snapshot + Package Lock Validation

**Status:** `pending`

### D.1 Snapshot antes/depois
- [ ] Snapshot de arquivos antes de editar
- [ ] Rollback para snapshot em caso de falha

### D.2 Validar package-lock
- [ ] Validar lockfile após install de dependências

---

## Phase E: Sandbox Docker

**Status:** `pending`

### E.1 Docker Sandbox
- [ ] Completar DockerSandboxExecutor
- [ ] Fallback para NativeSandboxExecutor
