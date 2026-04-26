# BFlow Agent LLM 🚀

**O cérebro autônomo para engenharia de software de elite.**

BFlow é um agente de software fundamentado no ciclo **ReAct (Observe-Think-Act-Verify)**, projetado para ser resiliente, rastreável e focado em manipulação estrutural de código (AST-first). Ele não apenas gera texto; ele entende, planeja, executa e valida mudanças complexas em codebases reais.

---

## ✨ Diferenciais

- **🧠 Arquitetura Multi-Agente**: Orquestração entre sub-agentes especializados (Research, Planning, Coder, Reviewer).
- **💾 Estado Persistente e Retomável**: Todo o progresso é salvo em checkpoints atômicos. Se a luz cair ou o modelo falhar, ele retoma exatamente de onde parou.
- **🌳 AST-First Development**: Manipulação de código via **Tree-sitter** e **ast-grep**. Menos regex, mais precisão semântica.
- **🔍 RAG Local de Alta Performance**: Integração com **LanceDB** para busca híbrida (vetorial + lexical) de contexto relevante.
- **🛡️ Guardrails & HITL**: Pontos de aprovação humana (Human-In-The-Loop) para ações críticas e comandos perigosos.
- **📊 Observabilidade Total**: Rastreamento completo via **OpenTelemetry** e logs estruturados JSONL com redação automática de segredos.

---

## 🛠️ Tecnologias Core

- **Runtime**: Node.js + TypeScript
- **Parsers**: Tree-sitter (TS, TSX, JS, JSX, JSON)
- **Refactoring**: ast-grep
- **Vector DB**: LanceDB
- **Tracing**: OpenTelemetry (SDK)
- **Providers**: Ollama (Local), OpenAI, Anthropic, OpenRouter

---

## 🚀 Como Iniciar

### Pré-requisitos
- Node.js (v18+)
- Ollama (opcional, para modelos locais como Qwen 2.5 Coder)

### Instalação
```bash
git clone https://github.com/lguilherme44/bflow-agent-llm.git
cd bflow-agent-llm
npm install
```

### Configuração
Crie um arquivo `.env` na raiz:
```env
AGENT_LLM_PROVIDER=ollama
AGENT_LLM_MODEL=qwen2.5-coder
AGENT_LLM_BASE_URL=http://localhost:11434
```

### Comandos Principais

#### Desenvolvimento
```bash
# Iniciar o agente em modo chat (desenvolvimento rápido)
npm run dev chat

# Iniciar o agente com watch mode (recarrega ao salvar)
npm run dev:agent chat

# Iniciar o servidor de integração com IDE (Continue.dev)
npm run dev:server
```

#### Produção / Build
```bash
# Validar tipos e compilar
npm run build

# Executar a partir do build
node dist/cli.js chat
```

---

## 📅 Roadmap & Progresso

### ✅ O que já temos (Fases 1-5 & 9)
- [x] **Core ReAct**: Loop completo de Observar, Pensar, Agir e Verificar.
- [x] **Gestão de Estado**: Checkpoints em disco e HITL funcional.
- [x] **Tools de Código**: Leitura/Edição estrutural via AST e TS Language Service.
- [x] **RAG Local**: Busca híbrida integrada ao Orchestrator.
- [x] **Observabilidade**: Tracing com spans e Logging estruturado.
- [x] **CLI**: Interface interativa para chat e inicialização.

### ⏳ Em Andamento
- [ ] **Fase 6**: Refinamento de loops de feedback (auto-correção de build/testes).
- [ ] **Fase 7**: Integração com ferramentas externas via MCP (Model Context Protocol).

### 🚀 Futuro
- [ ] Sandbox Docker para execução isolada de código.
- [ ] Suporte a múltiplos repositórios e monorepos complexos.
- [ ] Interface visual (Visual CLI) para acompanhamento de planos.

---

## 📄 Licença

Distribuído sob a licença MIT. Veja `LICENSE` para mais informações.

---
*Desenvolvido com ❤️ para transformar a engenharia de software com IA.*
