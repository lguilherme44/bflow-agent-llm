# TODO - Fase 1: Core do Agente

Objetivo: finalizar o cerebro do agente com estado retomavel, loop ReAct, tools robustas e gerenciamento de contexto.

Status inicial observado em 2026-04-22:

- [x] Estrutura base criada em `src/state`, `src/agent`, `src/tools`, `src/context`, `src/llm`.
- [x] State machine inicial existe.
- [x] Checkpoint em memoria existe.
- [x] ReAct loop inicial existe.
- [x] Tool builder/registry/executor inicial existem.
- [x] Context manager inicial existe.
- [x] Build TypeScript ainda falha. Resolvido: `npm.cmd run typecheck` passa.
- [x] Implementacao ainda nao esta pronta para uso real/persistente. Resolvido como core funcional: checkpoint em disco, HITL, loop ReAct e tools AST-first existem.

Status atualizado em 2026-04-22:

- [x] Fase 1 implementada como core funcional e testado.
- [x] Fase 2 implementada como fundacao AST-first com Tree-sitter, ast-grep, TypeScript Language Service, tools de codigo e terminal guardado.
- [x] Validacoes executadas: `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run start`.
- [ ] Pendencia proposital: cobertura de testes ainda e inicial; faltam fixtures completas, security scan, observabilidade persistente e benchmark.
- [x] Proxima etapa em andamento: Fase 3 - Integracao LLM + RAG.
- [x] Fase 3 inicial implementada: roteador multi-provider, redacao de secrets, RAG local incremental, `retrieve_context` e prompts versionados.
- [x] Proxima etapa sugerida: Fase 4 - Research/Planning Agents usando RAG antes de planejar.
- [x] Fase 5.0 Slice Básico implementado: OpenTelemetry com TracingService, spans por tool call, LLM call e agent run, exportador in-memory para testes.
- [x] NOVO: Criar skills.md (Fase 7.2 antecipada) como guia de convenções.
- [x] Fase 5.1 implementada: UnifiedLogger, log JSONL estruturado com redação de secrets, integração de logs no ReActLoop e TerminalService, testes de formatação inclusos.
- [x] Fase 4 implementada: Agentes de Research, Planning e Orchestrator criados. Multi-agent delegation funcional.
- [x] Fase 9.1 e 9.2 implementadas: CLI Interativa (`agent chat`) e inicializao (`agent init`).
- [x] Fase 9.3 e 9.4 implementadas: Interface Visual (TUI) com Ink, listagem e retomada de sessoes.
- [x] NOVO: Comando `/connect` interativo com suporte a selecao e download de modelos locais (Ollama/LM Studio).
- [x] NOVO: Trava de Seguranca (Safety Lock) no Orquestrador para aprovacao humana do plano de execucao.
- [ ] Prxima etapa sugerida: Fase 7 - Integracao com o SaaS ou finalizar pendencias de Observabilidade (LangSmith).
## 0. Base Tecnica e Build

- [x] Corrigir `tsconfig.json`/tipos Node para reconhecer `console`, `crypto`, `AbortController`, `AbortSignal`, `setTimeout` e `clearTimeout`.
- [x] Corrigir import incorreto de `ToolRegistry` em `src/tools/executor.ts`.
- [x] Remover imports/parametros nao usados ou adaptar o codigo para `noUnusedLocals` e `noUnusedParameters`.
- [x] Rodar `npx.cmd tsc --noEmit` sem erros.
- [x] Ajustar `package.json` com scripts uteis:
  - [x] `build`
  - [x] `typecheck`
  - [x] `dev` ou `start`
- [x] Decidir formato de modulo final:
  - [x] manter `NodeNext`
  - [x] ou alinhar `package.json` para ESM/CommonJS de forma consistente.

Pronto quando: o projeto compila limpo e possui comandos padrao para validar o core.

## 1.1 State Machine com Checkpointing

- [x] Revisar estados e transicoes atuais:
  - [x] `idle`
  - [x] `thinking`
  - [x] `acting`
  - [x] `observing`
  - [x] `awaiting_human`
  - [x] `error`
  - [x] `completed`
- [x] Criar eventos/transicoes explicitas em vez de transicoes soltas por status.
- [x] Garantir que todo `AgentState` seja 100% serializavel em JSON.
- [x] Adicionar validacao de schema/versionamento de checkpoint.
- [x] Implementar storage persistente em arquivo:
  - [x] `FileCheckpointStorage`
  - [x] diretorio configuravel
  - [x] escrita atomica
  - [x] listagem por agente/task
- [x] Implementar resume robusto:
  - [x] retomar de `awaiting_human` sem perder aprovacao pendente
  - [x] recuperar estados interrompidos em `thinking`/`acting`
  - [x] registrar motivo da retomada no historico
- [x] Implementar HITL como primeiro cidadao:
  - [x] pontos de interrupcao por tool perigosa
  - [x] pontos de interrupcao por politica configuravel
  - [x] rejeicao recuperavel com mensagem para o LLM
  - [x] aprovacao persistida no checkpoint
- [x] Adicionar testes unitarios para transicoes validas/invalidas.
- [x] Adicionar testes de checkpoint/resume.

Pronto quando: qualquer execucao pode pausar, salvar em disco, reiniciar o processo e continuar sem perder contexto critico.

## 1.2 Agent Loop ReAct

- [x] Formalizar ciclo:
  - [x] observar contexto
  - [x] pensar com LLM
  - [x] agir com tool calls
  - [x] verificar resultado
- [x] Separar o loop em metodos menores:
  - [x] `observe`
  - [x] `think`
  - [x] `act`
  - [x] `verify`
- [x] Adicionar prompt de sistema com contrato ReAct claro.
- [x] Incluir schemas das tools no prompt ou payload do LLM.
- [x] Melhorar parser de resposta:
  - [x] suportar uma tool call
  - [x] suportar multiplas tool calls
  - [x] suportar resposta final sem tool
  - [x] erro recuperavel quando JSON vier invalido
- [x] Implementar criterio real de conclusao:
  - [x] tool `complete_task`
  - [x] resposta final estruturada
  - [x] limite de iteracoes
  - [x] deteccao de loop
- [x] Criar politicas de verificacao:
  - [x] sucesso/falha de tool
  - [x] resultado vazio ou suspeito
  - [x] repeticao de acao
  - [x] necessidade de humano
- [x] Adicionar testes do loop com `MockLLMAdapter`.

Pronto quando: o agente executa uma tarefa mock de ponta a ponta, recupera erros de formato e encerra com estado correto.

## 1.3 Tool Schema Otimizado para LLM

- [x] Expandir `ToolSchema` com campos orientados a LLM:
  - [x] `summary`
  - [x] `description` em linguagem natural
  - [x] `whenToUse`
  - [x] `whenNotToUse`
  - [x] `expectedOutput`
  - [x] `failureModes`
  - [x] `recoverableErrors`
  - [x] `examples`
- [x] Melhorar builder de tool:
  - [x] validar nome
  - [x] validar descricao minima
  - [x] exigir exemplos para tools criticas
  - [x] suportar tags/categorias
- [x] Parcial: Trocar validacao manual basica por validador JSON Schema:
  - [x] avaliar `ajv` (Mantido o validador customizado para zero-dependências externas)
  - [x] retornar erros legiveis e acionaveis
- [x] Gerar prompt natural das tools:
  - [x] prosa curta
  - [x] JSON Schema
  - [x] exemplos few-shot
  - [x] erros recuperaveis
- [x] Padronizar mensagens de erro para o LLM:
  - [x] qual parametro falhou
  - [x] por que falhou
  - [x] como corrigir na proxima tentativa
- [x] Adicionar testes de schema, prompt e validacao.

Pronto quando: cada tool consegue explicar ao LLM quando usar, como chamar, exemplos validos e como se recuperar de erros.

## 1.4 Tool Executor Robusto

- [x] Garantir timeout em todas as tools.
- [x] Implementar retry com backoff exponencial real:
  - [x] delay base
  - [x] multiplicador
  - [x] max delay
  - [x] jitter
- [x] Adicionar politica de retry por tipo de erro:
  - [x] erro validacao: nao retry
  - [x] timeout: retry configuravel
  - [x] erro transiente: retry
  - [x] erro critico: rollback
- [x] Melhorar `ToolResult`:
  - [x] `attempts`
  - [x] `timedOut`
  - [x] `recoverable`
  - [x] `errorCode`
  - [x] `nextActionHint`
- [x] Implementar rollback em falha critica:
  - [x] rollback automatico quando a tool declarar suporte
  - [x] rollback timeout
  - [x] registrar sucesso/falha do rollback no estado
- [x] Adicionar hooks/eventos:
  - [x] `onToolStart`
  - [x] `onToolRetry`
  - [x] `onToolSuccess`
  - [x] `onToolFailure`
  - [x] `onRollback`
- [x] Pendente: Adicionar testes de timeout, retry, erro de validacao e rollback.
  - [x] erro de validacao
  - [x] timeout (Urgente: garantir antes de paralelizar)
  - [x] retry/backoff (Urgente)
  - [x] rollback (Critico para evitar estado inconsistente)

Pronto quando: falhas de tools sao previsiveis, registradas e recuperaveis pelo loop.

## 1.5 Context Management

- [x] Definir `ContextItem` para mensagens, arquivos, resultados de tool e memorias.
- [x] Implementar estimativa de tokens por item.
- [x] Melhorar compactacao inteligente:
  - [x] preservar objetivos
  - [x] preservar decisoes
  - [x] preservar erros e tentativas
  - [x] preservar arquivos editados/lidos
  - [x] preservar aprovacoes humanas
- [x] Criar sumarios estruturados:
  - [x] task atual
  - [x] progresso
  - [x] restricoes
  - [x] arquivos relevantes
  - [x] proximas acoes
- [x] Implementar priorizacao de arquivos relevantes:
  - [x] score por recencia
  - [x] score por frequencia
  - [x] score por relacao com task
  - [x] similaridade lexical inicial
  - [x] interface futura para embeddings/similaridade semantica
- [x] Adicionar API para registrar arquivos relevantes:
  - [x] `addFileContext`
  - [x] `markFileTouched`
  - [x] `markDecision`
  - [x] `markConstraint`
- [x] Garantir que compactacao nao descarte informacao critica.
- [x] Adicionar testes de compactacao e priorizacao.

Pronto quando: o agente consegue reduzir contexto grande mantendo informacao necessaria para continuar a tarefa.

## 1.6 Integracao e Exemplo Real

- [x] Transformar `src/index.ts` em exemplo limpo ou mover para `examples/`.
- [x] Criar tools reais minimas para desenvolvimento:
  - [x] `read_file`
  - [x] `list_files`
  - [x] `search_text`
  - [x] `write_file`
  - [x] `run_command`
- [x] Marcar tools destrutivas/perigosas para HITL:
  - [x] escrita de arquivo
  - [x] comandos shell
  - [x] remocao/movimentacao
  - [x] Criar snapshot antes/depois de edicoes
- [x] Parcial: Criar demo de pausa/retomada:
  - [x] iniciar task
  - [x] pausar em HITL
  - [x] salvar checkpoint
  - [x] retomar e aprovar
  - [x] documentar roteiro manual completo
  - [x] concluir
- [x] Documentar uso basico no README.

Pronto quando: existe um fluxo demonstravel de agente rodando, chamando tools, pausando para humano e retomando.

## 1.7 Ordem Sugerida de Execucao

- [x] Passo 1: corrigir build e scripts.
- [x] Passo 2: endurecer tipos centrais (`AgentState`, `ToolResult`, `ToolSchema`).
- [x] Passo 3: implementar checkpoint persistente e resume.
- [x] Passo 4: refatorar ReAct loop em etapas claras.
- [x] Passo 5: melhorar schema/validacao de tools.
- [x] Passo 6: robustecer executor com backoff, politicas e rollback.
- [x] Passo 7: evoluir contexto com compactacao estruturada e relevancia.
- [x] Passo 8: criar testes e demo final.

## 1.8 Checklist de Aceite da Fase 1

- [x] `npm run typecheck` passa.
- [x] `npm run build` passa.
- [x] Testes unitarios principais passam.
- [x] Estado completo pode ser salvo em JSON.
- [x] Estado pode ser restaurado e retomado.
- [x] HITL pausa e retoma corretamente.
- [x] Loop ReAct executa observar/pensar/agir/verificar.
- [x] Tools possuem schema, prosa, exemplos e erros recuperaveis.
- [x] Executor aplica timeout, retry/backoff e rollback.
- [x] Context manager compacta sem perder informacao critica.
- [x] Demo end-to-end funciona.

# TODO - Roadmap Completo do Agente

Visao: evoluir de um core ReAct funcional para um agente de engenharia de software confiavel, AST-first, observavel, seguro, multi-agent e integrado ao SaaS.

Principios de arquitetura:

- [x] AST first: nunca editar codigo por regex/string quando existir parser ou language server adequado.
- [x] Estado sempre retomavel: toda etapa longa deve aceitar checkpoint/resume.
- [x] Tools pequenas, composaveis e auditaveis.
- [x] HITL para decisoes destrutivas, caras, ambiguas ou sensiveis.
- [x] Validar antes de aceitar: typecheck, lint, testes e security scan.
- [ ] Parcial: Observabilidade desde o inicio: todo custo, comando, arquivo e decisao deve ser rastreavel.
- [ ] Parcial: Contexto sob controle: RAG + compactacao, nunca "jogar tudo na janela".
- [ ] Parcial: Privilegios minimos: cada agente/tool recebe apenas o acesso necessario.
- [ ] Avaliacao continua: medir taxa de sucesso, regressao, custo e correcao humana.

## Fase 2: Tools de Codigo - AST First

Regra de ouro: nunca manipular codigo como string/regex quando a mudanca puder ser feita via AST, parser estrutural ou language server.

### 2.0 Fundacao AST

- [x] Definir interface comum para representacao de codigo:
  - [x] `CodeDocument`
  - [x] `AstNode`
  - [x] `SymbolReference`
  - [x] `EditPlan`
  - [x] `TextPatch`
- [x] Definir fluxo seguro de edicao:
  - [x] parse
  - [x] localizar alvo
  - [x] planejar transformacao
  - [x] aplicar patch minimo
  - [x] formatar
  - [x] typecheck
  - [x] validar diff
- [x] Toda tool de edicao deve retornar:
  - [x] arquivos lidos
  - [x] arquivos modificados
  - [x] resumo semantico da mudanca
  - [x] diff
  - [x] validacoes executadas
- [x] Criar fallback explicito para quando AST nao suportar o caso:
  - [x] exigir justificativa
  - [x] exigir HITL se for edicao ampla
  - [x] exigir validacao reforcada.

### 2.1 Integrar Tree-sitter para Parsing Incremental

- [x] Escolher bindings Node/TS para Tree-sitter.
- [x] Instalar grammars:
  - [x] TSX
  - [x] TypeScript
  - [x] JavaScript
  - [x] JSON
- [x] Criar `TreeSitterParserService`.
- [x] Implementar parsing incremental por arquivo.
- [x] Cachear AST por filepath + hash de conteudo.
- [x] Mapear entidades:
  - [x] funcoes
  - [x] arrow functions
  - [x] classes
  - [x] methods
  - [x] interfaces/types
  - [x] imports
  - [x] exports
  - [x] JSX elements
  - [x] hooks React
  - [x] chamadas de funcao
- [x] Criar queries Tree-sitter versionadas por linguagem.
- [x] Criar testes fixture-based para arquivos TS/TSX/JS/JSON.
  - [x] teste TS inicial
  - [x] fixtures completas TS/TSX/JS/JSON
- [x] Expor tool `parseFileAst(filepath)`.

Pronto quando: o agente consegue ler um arquivo TSX e retornar mapa estrutural confiavel sem depender de regex.

### 2.2 Integrar ast-grep para Refactoring Estrutural

- [x] Escolher integracao:
  - [x] CLI `ast-grep` (via Node API)
  - [x] Node API se estiver madura
- [x] Criar `AstGrepService`.
- [x] Implementar busca estrutural com regras declarativas.
- [x] Implementar transformacoes semanticas:
  - [x] sync para async
  - [x] adicionar `await` nos call sites
  - [x] trocar API antiga por API nova
  - [x] migrar props React
  - [x] renomear imports
- [x] Implementar rename seguro com dry-run.
- [x] Toda transformacao deve gerar `EditPlan` antes de aplicar.
- [x] Adicionar suporte a preview de diff antes da escrita.
- [x] Criar biblioteca local de receitas de refactor em `rules/ast-grep`.
- [x] Adicionar testes com fixtures de antes/depois.

Pronto quando: refactors estruturais comuns podem ser aplicados em multiplos arquivos com preview, rollback e validacao.

### 2.3 Integrar TypeScript Language Server

- [x] Criar `TypeScriptLanguageService`.
- [x] Inicializar projeto por `tsconfig.json`.
- [x] Implementar:
  - [x] go-to-definition
  - [x] find-references
  - [x] rename refactoring
  - [x] organize imports
  - [x] diagnostics em tempo real
  - [x] quick fixes
- [x] Rodar type checking antes de aplicar mudancas sensiveis.
- [x] Rodar type checking depois de aplicar mudancas.
- [x] Mapear erros TS para mensagens recuperaveis para o LLM.
- [x] Suportar monorepo/multiplos `tsconfig`.
- [x] Criar cache por projeto para nao reinicializar TS LS a cada tool call.

Pronto quando: o agente consegue saber onde um simbolo e definido, onde e usado e renomea-lo sem quebrar referencias.

### 2.4 Criar Tools de Arquivo com AST

- [x] `readFile(filepath)`:
  - [x] retorna texto
  - [x] retorna AST resumida
  - [x] retorna simbolos principais
  - [x] retorna imports/exports
  - [x] retorna diagnostics se aplicavel
- [x] `editFile(filepath, astTransform)`:
  - [x] aceita transformacao declarativa
  - [x] aplica via AST/ast-grep/TS LS
  - [x] gera diff
  - [x] valida sintaxe
  - [x] valida types quando TS/TSX
- [x] `searchCode(query)`:
  - [x] busca textual com ripgrep
  - [x] busca estrutural com ast-grep
  - [x] busca semantica via RAG
  - [x] retorna ranking explicavel
- [x] `createFile(filepath, content)`:
  - [x] valida path permitido
  - [x] valida sintaxe
  - [x] roda formatter
  - [x] registra arquivo novo no contexto
- [x] `renameSymbol(filepath, position, newName)`.
- [x] `findReferences(filepath, position)`.
- [x] `applyEditPlan(planId)` com HITL opcional.
- [x] `revertEditPlan(planId)` para rollback.

Pronto quando: o agente possui CRUD de codigo com AST, diffs e validacao.

### 2.5 Criar Tools de Terminal

- [x] `executeCommand(cmd, cwd)`:
  - [x] sandbox/restricted shell
  - [x] whitelist/denylist de comandos
  - [x] timeout obrigatorio
  - [x] limite de output
  - [x] redacao de secrets
  - [x] registro no trace
- [x] `runTests(pattern?)`:
  - [x] detecta framework
  - [x] executa testes relevantes
  - [x] parseia falhas
  - [x] sugere arquivos relacionados
- [x] `runLinter()`:
  - [x] ESLint
  - [x] Prettier
  - [x] auto-fix quando seguro
  - [x] diff apos auto-fix
- [x] `runBuild()`:
  - [x] compilacao TypeScript
  - [x] parse de diagnostics
  - [x] associar erros aos arquivos modificados
- [ ] Parcial: `installDependency(package)`:
  - [x] sempre requer HITL
  - [x] registra motivo
  - [ ] valida lockfile

Pronto quando: comandos sao executados de forma rastreavel, limitada e recuperavel.

## Fase 3: Integracao LLM + RAG

### 3.1 Criar Adapter LLM Multi-Provider

- [x] Definir interface `LLMProvider`.
- [x] Suportar OpenAI como provider primary.
- [x] Suportar Anthropic como provider alternativo.
- [x] Suportar OpenRouter como fallback/custo.
- [x] Suportar Ollama (Local).
- [x] Suportar LM Studio (Local).
- [x] Implementar roteamento por tarefa:
  - [x] planejamento
  - [x] codigo
  - [x] revisao
  - [x] resumo
  - [x] debugging
- [x] Implementar fallback automatico por:
  - [x] timeout
  - [x] rate limit
- [ ] rate limit por task (Necessario para múltiplos sub-agentes paralelos)
- [x] custo maximo
- [x] erro de provider
- [ ] Parcial: Implementar streaming opcional.
  - [x] capacidades declaradas por provider
  - [x] Integrar LLM Streaming (runtime exposto ao loop)
- [x] Implementar tool/function calling nativo quando provider suportar.
- [x] Medir tokens e custo por chamada.
- [x] Criar redacao de secrets antes de enviar contexto ao LLM.
- [x] NOVO: Interface interativa `/connect` para configuracao dinamica de provedores.
- [x] NOVO: Integracao com APIs locais para listagem e download automatico de modelos (Ollama/LM Studio).
- [x] Criar testes com mock provider e golden outputs.

Pronto quando: o agente troca de provider sem mudar o loop principal.

### 3.2 Implementar RAG Interno do SaaS
- [x] Escolher vector DB local:
  - [x] LanceDB (escolhido — embedded, in-process, zero infra, persistente em disco)
  - [x] store vetorial local em memoria como fundacao substituivel
- [x] Criar pipeline de indexacao da codebase:
  - [x] chunk por simbolo AST
  - [x] chunk por arquivo markdown
  - [x] chunk por ADR
  - [x] chunk por teste
  - [x] chunk por rota/API
- [x] Criar metadata por chunk:
  - [x] filepath
  - [x] linguagem
  - [x] simbolos
  - [x] imports/exports
  - [x] ultima modificacao
  - [x] owner/modulo
- [x] Implementar reindex incremental por hash.
- [x] Indexar documentacao interna.
- [x] Indexar ADRs e padroes de codigo.
- [x] Unicode-aware tokenization (UTF-8) para suporte robusto a Português.
- [x] Implementar retrieval hibrido:
  - [x] vetor (LanceDB)
  - [x] lexical (Lunr/BM25)
  - [x] structural/AST
  - [x] recencia
- [x] Implementar reranking explicavel (RRF).
- [x] Criar tool `retrieve_context(task, filters)`.
- [x] Criar benchmark de retrieval com perguntas conhecidas (83% hit@5).

Pronto quando: o agente encontra arquivos relevantes antes de editar e explica por que escolheu cada um.

### 3.3 Criar Prompt Engineering Base

- [x] Criar system prompt base com:
  - [x] stack do SaaS
  - [x] padroes de codigo
  - [x] convencoes de testes
  - [x] regras de seguranca
  - [x] politica AST-first
  - [x] politica HITL
- [x] Criar prompts por papel:
  - [x] Research Agent
  - [x] Planning Agent
  - [x] Coder Agent
  - [x] Reviewer Agent
  - [x] Test Agent
  - [x] Debug Agent
- [x] Criar few-shot examples de tasks bem-sucedidas.
- [x] Criar exemplos negativos: o que nao fazer.
- [x] Instruir raciocinio antes de agir sem expor cadeia privada ao usuario:
  - [x] gerar plano curto
  - [x] declarar suposicoes
  - [x] chamar tools
  - [x] resumir verificacao
- [x] Criar prompt contract para saida estruturada em JSON.
- [x] Criar avaliador automatico de respostas malformadas.

Pronto quando: prompts sao versionados, testaveis e reaproveitaveis por agente.

## Fase 4: Planning & Orchestration

### 4.1 Implementar Research Agent

- [x] Analisa pedido do usuario.
- [x] Identifica tipo de tarefa:
  - [x] bugfix
  - [x] feature
  - [x] refactor
  - [x] teste
  - [x] investigacao
  - [x] documentacao
- [x] Busca na codebase com RAG + grep + AST.
- [x] Identifica entry points.
- [x] Identifica dependencias e arquivos relacionados.
- [x] Identifica riscos:
  - [x] migracao ampla
  - [x] config sensivel
  - [x] schema/database
  - [x] auth/security
  - [x] billing/pagamentos
- [x] Produz `ResearchBrief` com evidencias e referencias.

Pronto quando: antes de planejar, o agente sabe onde tocar e quais riscos observar.

### 4.2 Implementar Planning Agent

- [x] Gera plano estruturado em Markdown com checkboxes.
- [x] Divide em streams paralelos quando possivel.
- [x] Define dono de cada stream.
- [x] Define arquivos provaveis de escrita por stream.
- [x] Define validacoes por stream.
- [x] Marca tarefas bloqueantes e independentes.
- [x] Estima risco e custo.
- [x] Atualiza o plano conforme novas descobertas.
- [x] Exemplo de output esperado:

```markdown
## Stream A - API Contract
- [ ] Add Zod schema for new endpoint
- [ ] Add route handler
- [ ] Add unit tests

## Stream B - UI Changes
- [ ] Add React component
- [ ] Add loading/error states

## Stream C - Verification
- [ ] Integration tests
- [ ] Manual browser check
```

Pronto quando: qualquer task media vira um plano verificavel, paralelo quando seguro e facil de acompanhar.

### 4.3 Implementar Orchestrator Agent

- [x] Orchestrator nao escreve codigo diretamente em tarefas complexas.
- [x] Delega para sub-agentes especializados.
- [x] Mantem tasklist atualizada.
- [x] Garante isolamento de arquivos por stream.
- [x] Consolida resultados dos sub-agentes.
- [x] Executa verificacao end-to-end:
  - [x] testes
  - [x] typecheck
  - [x] lint
  - [x] screenshots se UI
  - [x] security scan quando aplicavel
- [x] Cria commits granulares:
  - [x] um commit por task/coorte logica
  - [x] mensagem descritiva
  - [x] inclui validacoes executadas
- [x] Escala para humano quando:
  - [x] conflito de merge ambiguo
  - [x] risco alto
  - [x] falha repetida
  - [x] custo ultrapassa limite
- [x] NOVO: Ponto de Controle (Safety Lock) obrigatorio para aprovacao de plano de execucao antes do inicio.

Pronto quando: o agente coordena trabalho complexo sem virar um bloco monolitico opaco.

## Fase 5: Observabilidade & Guardrails (PRIORIDADE: Slice básico antes da Fase 6)

### 5.0 Slice Básico (Urgente)
- [x] Implementar OpenTelemetry (OTel).
- [x] Spans por tool call.
- [x] Spans por chamada LLM.
- [x] Spans por agent run.
- [x] Visualização básica de traces (voar sem instrumentos é proibido).
- [x] Testes automatizados com InMemorySpanExporter (3 testes).

### 5.1 Logging Unificado

- [x] Registrar todos os comandos executados.
- [x] Registrar cwd, exit code, duracao e output resumido.
- [x] Registrar respostas do LLM:
  - [x] provider
  - [x] modelo
  - [x] prompt tokens
  - [x] completion tokens
  - [x] custo estimado
  - [x] latencia
- [x] Registrar resultados de tools:
  - [x] sucesso/falha
  - [x] tentativas
  - [x] rollback
  - [x] erro recuperavel
- [x] Registrar arquivos lidos/modificados.
- [x] Redigir secrets em logs.
- [x] Criar log estruturado JSONL por task.

Pronto quando: qualquer execucao pode ser auditada depois.

### 5.2 Tracing Distribuido

- [x] Integrar OpenTelemetry (Hierárquico).
- [x] Cada task vira um trace (Orchestrator).
- [x] Cada tool call vira um span.
- [x] Cada chamada LLM vira um span.
- [x] Cada sub-agente vira um span/trace filho.
- [x] Propagar `traceId` pelo estado (Implicitamente via context OTel).
- [x] Visualizar fluxo de execucao (Via Jaeger/Console).
- [ ] Integrar LangSmith ou equivalente quando fizer sentido.
- [x] Medir gargalos:
  - [x] latencia de LLM
  - [x] latencia de tools
  - [x] retries
  - [x] custo por fase

Pronto quando: da para ver onde o agente pensou, agiu, falhou, recuperou e gastou.

### 5.3 Guardrails de Seguranca

- [x] Whitelist de comandos permitidos.
- [x] Denylist de comandos perigosos:
  - [x] `rm -rf /`
  - [x] `format`
  - [x] `del /s`
  - [x] `drop database`
  - [x] comandos com secrets inline
- [x] Sandbox Docker para execucao de codigo (DockerSandboxExecutor + NativeSandboxExecutor fallback).
- [ ] Avaliar gVisor para isolamento mais forte.
- [x] Restricted shell para ambientes sem Docker.
- [x] Permitir apenas caminhos dentro do workspace.
- [x] Bloquear escrita em:
  - [x] `.env`
  - [x] secrets
  - [x] chaves privadas
  - [x] configs de deploy sensiveis
  - [x] arquivos fora do repo
- [x] HITL obrigatorio para:
  - [x] modificacoes em arquivos sensiveis
  - [x] instalacao de dependencias
  - [x] comandos destrutivos
  - [x] migracoes de banco
  - [x] mudancas de auth/billing
- [x] Criar `RiskPolicyEngine`.
- [x] Criar score de risco por tool call.

Pronto quando: o agente nao consegue fazer uma acao perigosa sem politica explicita e aprovacao quando necessario.

### 5.4 Validacao Automatica

- [x] Rodar build antes de permitir commit (Integrado em `git_commit`).
- [x] Rodar build antes de finalizar task (Integrado em `complete_task`).
- [x] Rodar lint antes de permitir commit.
- [x] Rodar testes antes de finalizar task.
- [x] Mapear erros de validacao para diagnosticos estruturados.
- [x] Validar syntax e types em edicoes de arquivo.
- [ ] Validar package lock apos dependencias.
- [ ] Validar migrations com dry-run quando possivel.
- [ ] Validar screenshots para UI (E2E):
  - [ ] desktop
  - [ ] mobile
  - [ ] estados loading/error
- [x] Criar `AcceptanceGate` que decide se a task pode ser marcada como concluida.

Pronto quando: nenhuma mudanca e considerada pronta sem passar pelos gates definidos.

## Fase 6: Multi-Agent & Paralelizacao

### 6.1 Implementar Sub-Agentes Especializados

- [x] `CoderAgent`: (Implementado via CODER_PROMPT)
- [x] `ReviewerAgent`: (Implementado via REVIEWER_PROMPT)
- [x] `TestAgent`: (Implementado via TESTER_PROMPT)
- [x] `DebugAgent`: (Implementado via DEBUG_PROMPT)
- [x] `DocsAgent`:
  - [ ] atualiza README/docs/ADRs quando necessario
- [ ] `MigrationAgent`:
  - [ ] cuida de database/schema quando existir
  - [ ] sempre sob HITL reforcado
- [x] Definir permissoes por agente (Toolset restrito por prompt e Orchestrator).
- [ ] Definir tool budget por agente.

Pronto quando: o trabalho pode ser dividido por especialidade com privilegio minimo.

### 6.2 Isolamento de Estado por Stream

- [x] Cada stream trabalha em diretorio/git worktree separado (via `WorkspaceManager`).
- [x] Cada stream tem checkpoint separado (natural via Orchestrator loop).
- [x] Cada stream tem trace separado ligado ao trace raiz.
- [x] Merge automatico quando streams terminam (via Git merge em `releaseLease`).
- [x] Detectar conflito antes de aplicar merge (Git nativo).
- [x] Resolucao de conflitos delegada ao Orchestrator (Reporta falha se merge falhar).
- [ ] Criar snapshot de arquivos antes/depois.
- [x] Impedir dois agentes de editarem o mesmo arquivo sem lock (Garantido pelo isolamento de worktree).
- [x] Criar `WorkspaceLeaseManager` (Implementado como `WorkspaceManager`).

Pronto quando: paralelizacao nao causa sobrescrita acidental nem mistura de contexto.

### 6.3 Implementar Feedback Loops

- [x] Se testes falham, Debug Agent investiga.
- [x] Se build quebra, Coder Agent corrige.
- [x] Se reviewer encontra bug, volta para Coder Agent.
- [x] Se lint falha, aplicar autofix ou pedir ajuste.
- [x] Maximo 3 iteracoes antes de escalar para humano.
- [x] Registrar cada iteracao no trace.
- [x] Guardar padroes de falha para melhorar prompts/tools (Mecanismo básico de feedback loop).
- [x] Encerrar cedo quando o custo ultrapassar limite.

Pronto quando: o agente melhora a propria saida dentro de limites claros.

## Fase 7: Integracao com o SaaS

### 7.0 Estratégia de Autenticação (Faltando)
- [ ] Definir estratégia explicitas de autenticação (OAuth/tokens de serviço por ambiente).
- [ ] Gerenciamento de credenciais via Vault/Secrets Manager.

### 7.1 Criar MCP Server para o SaaS

- [ ] Expor APIs internas como tools padronizadas.
- [ ] Documentar schema para o LLM consumir.
- [ ] Autenticacao segura para tools internas.
- [ ] Permissoes por ambiente:
  - [ ] local
  - [ ] staging
  - [ ] production
- [ ] HITL obrigatorio para operacoes em production.
- [ ] Criar tools MCP:
  - [ ] consultar usuario/tenant
  - [ ] consultar logs de app
  - [ ] consultar feature flags
  - [ ] consultar metricas
  - [ ] consultar jobs/filas
- [ ] Registrar auditoria de toda chamada MCP.

Pronto quando: o agente pode interagir com o SaaS por contrato seguro, nao por hacks ad hoc.

### 7.2 Criar `skills.md` do Projeto
- [x] Criar arquivo `skills.md` ou `AGENTS.md` na raiz do SaaS.
- [ ] Documentar stack.
- [ ] Documentar padroes de React:
  - [ ] hooks
  - [ ] componentes
  - [ ] state management
  - [ ] loading/error states
- [ ] Documentar estrutura de API:
  - [ ] routes
  - [ ] controllers
  - [ ] services
  - [ ] repositories
- [ ] Documentar regras de negocio criticas.
- [ ] Documentar convencoes de teste.
- [ ] Documentar convencoes de commits/PR.
- [ ] Documentar areas perigosas.
- [ ] Fazer agente ler isso no inicio de toda sessao.
- [ ] Indexar `skills.md` no RAG com prioridade alta.

Pronto quando: o agente entende os costumes da casa antes de mexer no codigo.

### 7.3 Integrar com Git

- [ ] Criar branch por feature/bugfix.
- [ ] Detectar working tree suja antes de editar.
- [ ] Nunca sobrescrever mudancas humanas sem aprovacao.
- [ ] Commits atomicos com mensagens descritivas.
- [ ] Associar commit a task/trace.
- [ ] Push opcional com HITL.
- [ ] Abrir PR com descricao gerada:
  - [ ] resumo
  - [ ] motivacao
  - [ ] mudancas
  - [ ] testes
  - [ ] riscos
  - [ ] screenshots se UI
- [ ] Responder comentarios de review quando integrado ao GitHub.

Pronto quando: o fluxo do agente termina em PR revisavel, nao apenas arquivos modificados.

### 7.4 Integrar com CI/CD

- [ ] Agente observa resultado do pipeline.
- [ ] Se CI falha, busca logs.
- [ ] Resume falha em linguagem clara.
- [ ] Identifica arquivo/commit provavel.
- [ ] Propoe correcao.
- [ ] Aplica fix em novo commit quando seguro.
- [ ] Limita iteracoes de fix de CI.
- [ ] Escala para humano quando falha for infra/segredo/permissao.

Pronto quando: o agente acompanha a mudanca ate o CI ficar verde ou ate precisar de humano.

## Fase 8: Testes & Validacao do Agente

### 8.1 Criar Benchmark de Tasks Conhecidas

- [ ] Coletar bugfixes reais anonimizados.
- [ ] Coletar features pequenas ja implementadas.
- [ ] Criar snapshots de repos antes da solucao.
- [ ] Definir resultado esperado.
- [ ] Medir:
  - [ ] taxa de sucesso
  - [ ] iteracoes necessarias
  - [ ] tempo
  - [ ] custo
  - [ ] quantidade de HITL
  - [ ] regressao introduzida
- [ ] Rodar benchmark por modelo/provider.
- [ ] Guardar traces para analise posterior.

Pronto quando: melhora do agente e medida, nao apenas sentida.

### 8.2 Metricas de Qualidade

- [ ] Bug rate: agente introduz mais bugs do que resolve?
- [ ] Time-to-feature: tempo medio de requisicao a merge.
- [ ] Correction effort: tempo humano gasto corrigindo o agente.
- [ ] Review burden: numero medio de comentarios por PR.
- [ ] Test pass rate: percentual de execucoes com testes verdes.
- [ ] Build pass rate.
- [ ] Cost per merged task.
- [ ] Context efficiency: tokens uteis vs tokens totais.
- [ ] Tool success rate.
- [ ] HITL interruption rate.

Pronto quando: existe painel ou relatorio de qualidade por versao do agente.

### 8.3 A/B Test Agente vs Humano

- [ ] Selecionar tasks similares.
- [ ] Controlar complexidade.
- [ ] Comparar tempo ate PR.
- [ ] Comparar bugs encontrados em review.
- [ ] Comparar retrabalho.
- [ ] Comparar satisfacao do reviewer.
- [ ] Usar resultados para decidir onde o agente deve atuar sozinho e onde deve assistir humanos.

Pronto quando: sabemos com dados quais classes de tarefa o agente ja faz bem.

### 8.4 Loop de Melhoria Continua

- [ ] Coletar falhas do agente.
- [ ] Classificar falhas:
  - [ ] contexto insuficiente
  - [ ] tool ruim
  - [ ] prompt ruim
  - [ ] modelo inadequado
  - [ ] validacao ausente
  - [ ] bug de orquestracao
- [ ] Atualizar prompts e few-shot examples.
- [ ] Refinar tools baseado em padroes de erro.
- [ ] Adicionar novas regras de guardrail.
- [ ] Adicionar novos benchmarks para cada regressao.
- [ ] Versionar releases do agente.

Pronto quando: cada falha importante vira melhoria testavel.

## Ideias Extras para um Agente de Engenharia Forte em 2026

### Memoria e Aprendizado Local

- [ ] Criar memoria por projeto, nao global demais.
- [ ] Separar memorias:
  - [ ] convencoes
  - [ ] decisoes
  - [ ] bugs recorrentes
  - [ ] comandos uteis
  - [ ] areas perigosas
- [ ] Exigir fonte/evidencia para memorias novas.
- [ ] Permitir expirar memorias antigas.
- [ ] Permitir humano aprovar memorias permanentes.

### Modelo de Risco Antes de Agir

- [ ] Antes de toda acao, calcular `riskScore`.
- [ ] Fatores:
  - [ ] arquivo sensivel
  - [ ] comando destrutivo
  - [ ] escopo amplo
  - [ ] baixa confianca
  - [ ] ausencia de testes
  - [ ] mudanca em auth/billing/data
- [ ] Acoes de baixo risco podem seguir automaticamente.
- [ ] Acoes de medio risco pedem plano/verificacao reforcada.
- [ ] Acoes de alto risco exigem HITL.

### Diff Intelligence

- [ ] Criar analisador de diff semantico.
- [ ] Classificar mudancas:
  - [ ] comportamento
  - [ ] teste
  - [ ] estilo
  - [ ] config
  - [ ] dependencias
- [ ] Detectar diff suspeito:
  - [ ] arquivo demais
  - [ ] remocao grande
  - [ ] mudanca fora do plano
  - [ ] alteracao em lockfile sem dependencia declarada
- [ ] Exigir justificativa para diff fora do plano.

### UI Verification

- [ ] Integrar Playwright.
- [ ] Criar snapshots desktop/mobile.
- [ ] Verificar console errors.
- [ ] Verificar network failures.
- [ ] Verificar texto sobreposto.
- [ ] Verificar estados loading/error/empty.
- [ ] Incluir screenshots no trace/PR.

### Banco de Dados e Migrations

- [ ] Detectar migrations automaticamente.
- [ ] Exigir HITL para migrations destrutivas.
- [ ] Rodar migration em banco ephemeral.
- [ ] Rodar rollback quando suportado.
- [ ] Validar compatibilidade backward/forward em deploy gradual.

### Contratos e APIs

- [ ] Gerar/validar OpenAPI quando aplicavel.
- [ ] Validar Zod/schema/runtime contracts.
- [ ] Detectar breaking changes.
- [ ] Atualizar clients gerados.
- [ ] Gerar testes de contrato.

### Politica de Custos

- [ ] Definir budget por task.
- [ ] Estimar custo antes de iniciar tarefas grandes.
- [ ] Escolher modelo menor para tarefas simples.
- [ ] Escalar para modelo mais forte apenas quando necessario.
- [ ] Encerrar ou pedir aprovacao ao ultrapassar budget.

### Privacidade e Secrets

- [ ] Scanner de secrets antes de contexto LLM.
- [ ] Redacao de `.env`, tokens, cookies e chaves.
- [ ] Bloquear envio de dados sensiveis para providers externos sem politica.
- [ ] Suportar modo local/offline para codigo sensivel.

### Reproducibilidade

- [ ] Toda task deve salvar:
  - [ ] prompt final
  - [ ] contexto recuperado
  - [ ] versao do modelo
  - [ ] versao das tools
  - [ ] comandos
  - [ ] diffs
  - [ ] resultados de validacao
- [ ] Permitir replay de uma task em modo dry-run.

## Stack Tecnologico Recomendada

| Componente | Tecnologia | Justificativa |
| --- | --- | --- |
| Framework | LangGraph ou Vercel AI SDK | State machines, HITL, checkpointing e fluxo agentico |
| LLM | GPT-4o / Claude 3.5 Sonnet | Raciocinio forte para codigo e planejamento |
| Local LLM | Ollama / LM Studio | Privacidade e custo zero para desenvolvimento |
| Fallback LLM | OpenRouter | Roteamento, custo e redundancia |
| AST Parsing | Tree-sitter + ast-grep | Manipulacao estrutural confiavel |
| Type Analysis | TypeScript Language Server | Refactoring semantico seguro |
| RAG | LanceDB/Chroma + Context7 | Contexto relevante da codebase e docs versionadas |
| Sandbox | Docker + gVisor | Isolamento de execucao |
| Observability | OpenTelemetry + LangSmith | Tracing, custos e depuracao |
| Protocolo | MCP | Integracao padronizada com tools |
| Test UI | Playwright | Validacao visual e funcional |
| Schema/Validation | Zod + JSON Schema/Ajv | Contratos claros entre tools, LLM e runtime |
| Git Automation | Git worktrees + GitHub API | Paralelizacao e PRs rastreaveis |

## Primeiros Passos Imediatos

- [ ] Dia 1: setup do repo TS com strict mode + scripts + Docker sandbox.
- [ ] Dia 2: implementar 3 tools basicas:
  - [ ] `readFile`
  - [ ] `editFile` via AST
  - [ ] `executeCommand`
- [ ] Dia 3: criar Agent Loop simples ReAct com 1 LLM real.
- [ ] Dia 4: dar uma task real e pequena e observar trace completo.
- [ ] Dia 5: adicionar Planning Agent e dividir tasks maiores.
- [ ] Dia 6: adicionar logging, guardrails e budget de custo.
- [ ] Dia 7: adicionar validacao automatica e benchmark inicial.

## Anti-Patterns para Evitar

| Nao faca | Faca |
| --- | --- |
| Manipular codigo com regex/string | Usar AST, Tree-sitter, ast-grep ou TS Language Server |
| Deixar agente rodar sem supervisao | HITL para operacoes criticas |
| Um agente monolitico para tudo | Sub-agentes especializados + Orchestrator |
| Ignorar custos desde o inicio | Monitorar tokens/custo por task |
| Gerar codigo sem validar | Typecheck + testes + lint antes de aceitar |
| Contexto ilimitado | Compactacao inteligente + RAG |
| Dar acesso total a todas as tools | Privilegios minimos por agente |
| Aceitar diff sem entender | Diff semantico + verificacao por risco |
| Misturar streams paralelos no mesmo workspace | Git worktrees e locks por arquivo |
| Confiar so no LLM para refactor | Language server, AST e testes de contrato |

## Definicao de Pronto do Agente 1.0

- [ ] Executa task real pequena de ponta a ponta.
- [ ] Usa AST para ler/editar codigo.
- [ ] Pausa para humano em operacoes criticas.
- [ ] Salva e retoma checkpoint em disco.
- [ ] Registra trace completo.
- [ ] Valida com typecheck, lint e testes.
- [ ] Gera diff claro e PR revisavel.
- [ ] Mede custo e tokens.
- [ ] Possui benchmark inicial.
- [ ] Nao acessa nem modifica recursos fora das politicas configuradas.

## Fase 9: Interface & Developer Experience (CLI Profissional)

Objetivo: transformar o agente em uma ferramenta de linha de comando de primeira classe, com baixa fricção e alta interatividade.

### 9.1 CLI Interativa (REPL)

- [x] Implementar shell interativo (`agent chat`) para conversas contínuas.
- [x] Suporte a multi-line input (via input sequencial).
- [ ] Highlight de sintaxe no terminal para código (Markdown/TS) e JSON.
- [x] Spinners e loading states claros para diferenciar "pensando", "agindo" e "observando" (logs coloridos).
- [x] Histórico de comandos (seta para cima) persistente entre sessões (nativo do readline).

### 9.2 Instalação Global e Experiência "Zero-Config"

- [x] Configurar campo `bin` no `package.json` para expor o comando `agent`.
- [x] Implementar `agent init` para configurar o diretório `.agent/` e `skills.md` em novos projetos.
- [ ] Detecção automática do contexto do projeto (Frameworks, Linguagens, Test Runners).
- [x] Suporte a configuração global em `~/.config/agent/config.json` (via .agentrc local por enquanto).

### 9.3 Interface Visual (TUI) com React/Ink

- [x] Avaliar e implementar a interface usando **Ink** (React para CLI) para componentes ricos.
- [x] Criar Dashboard de Status: mostrar agentes ativos, consumo de tokens e tempo de execução em tempo real.
- [ ] Visualizador de Diff Semântico: mostrar mudanças de código com cores e indentação clara no terminal.
- [x] Menu interativo de HITL: `[A]provar, [R]ejeitar` (Implementado em App.tsx).
- [ ] Notificações de sistema (opcional) para quando o agente terminar tarefas longas ou pedir atenção.
- [x] Logs "dobráveis": visualização limpa do pensamento do agente via ActivityRow.

### 9.4 Gestão de Sessões e Persistência

- [x] `agent list`: listar tarefas recentes e seus status.
- [x] `agent resume <id>`: retomar uma tarefa interrompida ou finalizada.
- [x] Persistência de histórico de mensagens e estado do orquestrador.
- [x] UI visual (TUI) suporta carregamento de estado inicial.
- [ ] `agent resume <task-id>`: retomar uma tarefa interrompida ou em estado de erro.
- [ ] `agent status`: ver o que o agente está fazendo no momento (se rodando em background).
- [ ] Exportação de logs/traces simplificada para depuração humana.

### 9.5 Integração com Workflow do Dev

- [ ] `agent commit`: agente analisa o diff e gera uma mensagem de commit seguindo Conventional Commits.
- [ ] `agent pr`: agente revisa a branch e prepara a descrição do Pull Request.
- [ ] Atalhos para ferramentas comuns: `agent test`, `agent lint`, `agent fix`.

### 9.6 Permissões e Segurança no Workspace

- [ ] Sistema de `Capabilities`: o agente deve pedir permissão ao iniciar (`agent grant`) para ler/escrever no workspace.
- [ ] Sandbox Mode: rodar comandos de terminal em um ambiente isolado (Docker/gVisor) por padrão.
- [ ] Denylist de arquivos sensíveis (ex: `.env`, chaves SSH) protegida por padrão no CLI.
- [ ] Auditoria Local: gerar um arquivo `.agent/audit.log` com hash de cada comando e arquivo alterado.

Pronto quando: usar o agente é tão natural quanto usar o `git` ou o `npm`, com uma interface visual que passa confiança e controle total ao desenvolvedor.
