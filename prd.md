# Product Requirements Document (PRD) - Bflow Agent

## 1. Visão Geral do Produto
**Nome do Produto**: Bflow Agent
**Objetivo**: Criar um assistente de engenharia de software autônomo (coding agent) otimizado para rodar localmente com LLMs menores (ex: modelos de 7B-8B com ~8GB VRAM) via provedores como LM Studio e Ollama, enquanto mantém compatibilidade com provedores na nuvem (OpenAI, Anthropic). O foco é privacidade, velocidade e integração nativa com o sistema do desenvolvedor.

## 2. Casos de Uso
1. **Refatoração e Edição de Código**: O usuário descreve uma tarefa e o agente planeja e altera o código do projeto atual de forma autônoma.
2. **Exploração e Contexto (RAG)**: O agente indexa o projeto atual para entender dependências, referências e regras de negócio antes de propor mudanças.
3. **Validação**: O agente é capaz de rodar linters e testes unitários localmente para garantir a estabilidade do código recém-alterado antes de declará-lo pronto.

## 3. Arquitetura
O sistema mudou de uma stack CLI legado para uma aplicação **Electron + React + Vite**.

- **Frontend (Renderer - React + Vite)**: 
  - *UI Principal*: Painel de chat flutuante, histórico de mensagens persistente e controles de execução.
  - *Sidebar Integrada*: Abas de "Tools" (ToolActivityPanel e DiffViewer), "MCP" e "Files" (mini-explorer).
  - *Settings*: Sincronização automática de modelos instalados via provedor (ex: `/v1/models`).
- **Backend (Main - Electron)**: 
  - Comunicação IPC via contextBridge.
  - Ponte para o *Core* através do módulo AgentRunner.
- **Agent Core (@bflow/core)**:
  - Baseado no SDK oficial `@openai/agents`.
  - Agente *Unified*: Em vez de múltiplos agentes complexos trocando informações via *Handoff*, o Bflow otimiza modelos com baixa VRAM agrupando todas as ferramentas em um único agente, aumentando as taxas de sucesso e velocidade de raciocínio.
  - *Ferramentas Implementadas*: `read_file`, `create_file`, `edit_file`, `retrieve_context`, `run_tests`, `run_linter`, `git_commit`, etc.

## 4. Requisitos Funcionais Principais
- **Interatividade Contínua**: O usuário deve poder parar a execução a qualquer momento ou prover feedback interativo (Approval Gate).
- **Integração com MCP (Model Context Protocol)**: O agente deve ser capaz de se conectar a servidores MCP de terceiros dinamicamente.
- **RAG Local e Leve**: O agente deve poder indexar a *workspace* (`LocalRagService`) para entender a relação semântica do código.
- **Testes e Lint Autônomos**: Validação integrada usando o ambiente do usuário (Node/npm).

## 5. Próximos Passos (Roadmap)
1. **Fase 5 - Fechamento**: Implementação de testes e2e automatizados garantindo estabilidade nas builds.
2. **Setup Automatizado**: Script de build global para facilitar a instalação do binário do Electron e registro no path do sistema operativo.
3. **Métricas Avançadas**: Integrar o agente principal com um *dashboard de telemetria externo* via WebSockets (Observability).
