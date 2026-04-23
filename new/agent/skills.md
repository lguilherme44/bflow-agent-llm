# Skills & Convenções do Projeto (skills.md)

Este documento define as diretrizes e convenções que o agente deve seguir ao trabalhar nesta codebase. **Leia este documento no início de cada sessão.**

## 1. Stack Tecnológica
- **Linguagem**: TypeScript (Strict Mode)
- **Runtime**: Node.js (ESM / NodeNext)
- **Framework de Agente**: LangGraph / Vercel AI SDK
- **LLMs**: GPT-4o, Claude 3.5 Sonnet, Ollama (Local), LM Studio (Local)
- **AST/Parsing**: Tree-sitter, ast-grep, TypeScript Language Service
- **Observabilidade**: OpenTelemetry + Tracing

## 2. Padrões de Código
- **AST-First**: Nunca use regex ou manipulação de string para editar código se houver suporte via AST ou Language Server.
- **Tipagem**: Use Tipos/Interfaces explícitos. Evite `any`.
- **Imutabilidade**: Prefira padrões imutáveis no estado do agente.
- **Errors**: Erros devem ser capturados e transformados em mensagens acionáveis para o LLM.

## 3. Fluxo de Trabalho do Agente
1. **Research**: Explorar o código usando RAG, grep e AST.
2. **Plan**: Criar um plano detalhado antes de qualquer edição.
3. **Act**: Executar edições granulares e validadas.
4. **Verify**: Rodar `typecheck`, `lint` e `testes`.
5. **Review**: Gerar diff semântico e aguardar aprovação (HITL) para ações críticas.

## 4. Segurança e Guardrails
- **Whitelist**: Apenas comandos permitidos em `executeCommand`.
- **Secrets**: Nunca exponha chaves em logs ou no contexto do LLM. Use redação automática.
- **Sandbox**: Execuções de código devem ocorrer em Docker (em desenvolvimento).
- **Paths**: Nunca acesse arquivos fora do diretório do projeto.

## 5. Convenções de Git
- **Branches**: `feature/agent-<task-id>` ou `bugfix/agent-<task-id>`.
- **Commits**: Mensagens claras seguindo [Conventional Commits](https://www.conventionalcommits.org/).
- **PRs**: Devem incluir resumo das mudanças, testes realizados e riscos identificados.

## 6. Autenticação e Integração
- **SaaS Auth**: O agente utiliza tokens de serviço (OAuth/Service Tokens) configurados por ambiente.
- **Local Dev**: Use `.env` local para chaves de API e configurações de ambiente.

## 7. Loop de Feedback
- Falhas em ferramentas ou prompts devem ser registradas como "Lessons Learned" para retroalimentar o sistema de prompts e configuração de ferramentas.
