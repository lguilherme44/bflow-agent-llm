# BFlow Agent LLM 🚀

**O cérebro autônomo para engenharia de software de elite.**

BFlow é um agente de software fundamentado no ciclo **ReAct (Observe-Think-Act-Verify)**, projetado para ser resiliente, rastreável e focado em manipulação estrutural de código (AST-first). Ele não apenas gera texto; ele entende, planeja, executa e valida mudanças complexas em codebases reais.

---

## ✨ Diferenciais

- **🧠 Arquitetura Multi-Agente**: Orquestração entre sub-agentes especializados (Research, Planning, Coder, Reviewer, Tester, Debugger, Docs, Migration).
- **💾 Estado Persistente e Retomável**: Todo o progresso é salvo em checkpoints atômicos. Se a luz cair ou o modelo falhar, ele retoma exatamente de onde parou.
- **🌳 AST-First Development**: Manipulação de código via **Tree-sitter** e **ast-grep**. Menos regex, mais precisão semântica.
- **🔍 RAG Local de Alta Performance**: Integração com **LanceDB** para busca híbrida (vetorial + lexical) de contexto relevante.
- **🛡️ Guardrails & HITL**: Pontos de aprovação humana (Human-In-The-Loop) para ações críticas e comandos perigosos.
- **📊 Observabilidade Total**: Dashboard integrado com token breakdown, custo estimado, latência e traces via **OpenTelemetry**.
- **💻 Otimizado para VRAM Local (8GB)**: Compressão inteligente de contexto e suporte a modelos GGUF com KV Cache quantizado.
- **⚙️ Configuração Dinâmica**: Gerenciamento de conexão simplificado via `.agentrc` e comando interativo `/connect`.

---

## 🛠️ Tecnologias Core

- **Runtime**: Node.js + TypeScript
- **Parsers**: Tree-sitter (TS, TSX, JS, JSX, JSON)
- **Refactoring**: ast-grep
- **Vector DB**: LanceDB
- **Tracing**: OpenTelemetry (SDK)
- **Integrations**: Model Context Protocol (MCP)
- **Providers**: Ollama (Local), OpenAI, Anthropic, OpenRouter, LM Studio

---

## 🚀 Como Iniciar

### Pré-requisitos
- Node.js (v18+ até v22)
- Ollama ou LM Studio (para execução local)

### Instalação
```bash
git clone https://github.com/lguilherme44/bflow-agent-llm.git
cd bflow-agent-llm
npm install
```

### Configuração (Recomendado)
Não é necessário configurar o `.env` manualmente para o LLM. Use o assistente interativo:
```bash
npm run vagent -- --connect
```
Isso criará o arquivo `.agentrc` com suas preferências de modelo, provedor e chaves de API.

### Comandos Principais

#### 🖥️ Visual CLI (Recomendado)
A melhor experiência interativa com progresso em tempo real e interface baseada em Ink:
```bash
# Iniciar interface visual
npm run vagent
```

#### 🛠️ Desenvolvimento e Chat
```bash
# Iniciar o agente em modo chat CLI simples
npm run dev chat

# Dentro do chat, use /connect para trocar de modelo
# /status para ver a conexão atual
```

---

## ⚡ Otimização para 8GB VRAM
Para rodar BFlow com performance máxima em hardware local limitado:

1. Use os scripts `.bat` otimizados (Windows):
   - `qwen2.5-coder-7b-q8.bat`: Inicia o Qwen 2.5 Coder 7B com **KV Cache quantizado (4-bit)**.
   - `Nemotron.bat`: Inicia o Nemotron Nano 9B v2.
2. O agente utiliza **Smart Context Compaction**, reduzindo automaticamente o contexto para caber na VRAM sem perder decisões críticas.

---

## 📅 Roadmap & Progresso

### ✅ O que já temos (Fases 1-6 & 9)
- [x] **Core ReAct**: Loop completo de Observar, Pensar, Agir e Verificar.
- [x] **Gestão de Estado**: Checkpoints em disco e HITL funcional.
- [x] **Multi-Agente Especializado**: Orquestração entre sub-agentes com **Feedback Loops**.
- [x] **Config-First Workflow**: Configuração via `/connect` e persistência em `.agentrc`.
- [x] **Tools de Código**: Leitura/Edição estrutural via AST e TS Language Service.
- [x] **RAG Local**: Busca híbrida (LanceDB) integrada ao Orchestrator.
- [x] **Observabilidade**: Dashboard de custos e traces OpenTelemetry.
- [x] **Integração MCP**: Suporte a ferramentas externas via protocolo MCP.
- [x] **Interface Visual**: Visual CLI (vagent) com feedback de progresso e tokens.

### ⏳ Em Andamento
- [ ] **Fase 7.1 (Parte 2)**: Expor APIs internas do SaaS como ferramentas MCP (MCP Server).

### 🚀 Futuro
- [ ] Sandbox Docker para execução isolada de código.
- [ ] Suporte a múltiplos repositórios e monorepos complexos.
- [ ] Suporte a Migrações de Banco de Dados automáticas com HITL.

---

## 📄 Licença

Distribuído sob a licença MIT. Veja `LICENSE` para mais informações.

---
*Desenvolvido com ❤️ para transformar a engenharia de software com IA.*
