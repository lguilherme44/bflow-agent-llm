import { ReActAgent, ReActConfig } from './react-loop.js';
import { AgentState, ExecutionPlan, ExecutionStream, ResearchBrief } from '../types/index.js';
import { ResearchAgent } from './research.js';
import { PlanningAgent } from './planning.js';
import { AgentStateMachine } from '../state/machine.js';
import { ToolRegistry } from '../tools/registry.js';
import { createDevelopmentToolRegistry } from '../tools/development-tools.js';
import { RiskPolicyEngine } from '../utils/risk-engine.js';
import { LLMResponseParser } from '../llm/adapter.js';
import { CODER_PROMPT, DEBUG_PROMPT, REVIEWER_PROMPT, TESTER_PROMPT } from '../prompts/specialized.js';
import { WorkspaceManager } from '../code/workspace-manager.js';
import { TerminalService } from '../code/terminal-service.js';

export type OrchestratorEvent = 
  | { type: 'phase_start'; phase: string }
  | { type: 'phase_complete'; phase: string; details?: string }
  | { type: 'message_added'; role: string; content: string }
  | { type: 'usage_update'; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'error'; message: string }
  | { type: 'human_approval_request'; toolCallId: string; toolName: string; args: any; riskEvaluation?: any };

export type OrchestratorUpdateCallback = (event: OrchestratorEvent) => void;

export class OrchestratorAgent {
  private researchAgent: ResearchAgent;
  private planningAgent: PlanningAgent;
  private totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private onUpdate?: OrchestratorUpdateCallback;
  private liveConfig: ReActConfig;
  private approvalResolver?: (approved: boolean) => void;
  private riskEngine: RiskPolicyEngine;
  private workspaceManager: WorkspaceManager;
  private workspaceRoot: string;
  private fallbackHumanApprovalCallback?: ReActConfig['humanApprovalCallback'];

  constructor(private config: ReActConfig) {
    const languageInstruction = "\n\nIMPORTANT: Always respond in the same language as the user's prompt. If the user speaks Portuguese, you MUST respond in Portuguese.";
    
    this.config.llmConfig = {
      ...this.config.llmConfig,
      systemPrompt: (this.config.llmConfig?.systemPrompt || '') + languageInstruction
    };

    this.workspaceRoot = (this.config.registry as { workspaceRoot?: string }).workspaceRoot || process.cwd();
    this.riskEngine = new RiskPolicyEngine(this.workspaceRoot);
    this.fallbackHumanApprovalCallback = this.config.humanApprovalCallback;
    const terminal = new TerminalService(this.workspaceRoot);
    this.workspaceManager = new WorkspaceManager(this.workspaceRoot, terminal);
    this.liveConfig = {
        ...this.config,
        onUpdate: (event) => {
            if (event.type === 'message_added') {
                this.notify({ type: 'message_added', role: event.role!, content: event.content! });
            }
        },
        humanApprovalPolicy: (toolCall) => {
            const evaluation = this.riskEngine.evaluateToolCall(toolCall.toolName, toolCall.arguments);
            if (evaluation.level === 'blocked') {
                return `BLOCKED: ${evaluation.reasons.join(', ')}`;
            }
            if (evaluation.level === 'high' || evaluation.level === 'medium') {
                return evaluation.reasons.join(', ');
            }
            return undefined;
        },
        humanApprovalCallback: async (toolCall, reason) => {
            const evaluation = this.riskEngine.evaluateToolCall(toolCall.toolName, toolCall.arguments);

            if (this.onUpdate) {
                return new Promise((resolve) => {
                    this.approvalResolver = resolve;
                    this.notify({ 
                        type: 'human_approval_request', 
                        toolCallId: toolCall.id,
                        toolName: toolCall.toolName,
                        args: toolCall.arguments,
                        riskEvaluation: evaluation
                    });
                });
            }

            if (this.fallbackHumanApprovalCallback) {
                return this.fallbackHumanApprovalCallback(toolCall, reason);
            }

            return false;
        }
    };

    this.researchAgent = new ResearchAgent(this.liveConfig);
    this.planningAgent = new PlanningAgent(this.liveConfig);
  }

  public setUpdateCallback(callback: OrchestratorUpdateCallback) {
    this.onUpdate = callback;
    this.notify({ type: 'usage_update', usage: this.totalUsage });
  }

  private notify(event: OrchestratorEvent) {
    this.onUpdate?.(event);
  }

  private updateUsage(state: AgentState) {
    this.totalUsage.totalTokens = state.metadata.totalTokensUsed || 0;
    this.notify({ type: 'usage_update', usage: this.totalUsage });
  }

  async run(task: string, existingState?: AgentState): Promise<{ state: AgentState; plan?: ExecutionPlan }> {
    let state = existingState ?? AgentStateMachine.create(`Orchestrate: ${task}`);
    
    const tracing = this.config.tracing;
    const logger = this.config.logger;
    const orchestratorSpan = tracing?.startOrchestratorSpan(task, state.id);
    
    logger?.logEvent(state.id, 'orchestrator_started', { task });
    state = AgentStateMachine.dispatch(state, { type: 'task_started' });

    const now = new Date();
    const days = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    const dayName = days[now.getDay()];
    const dateStr = now.toLocaleDateString('pt-BR');
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const currentContext = `Data: ${dateStr} (${dayName}), Hora: ${timeStr}`;

    // --- ETAPA: CLASSIFICAÇÃO DE INTENÇÃO ---
    const intentSpan = tracing?.startPhaseSpan('Intent Classification', orchestratorSpan);
    const intentPrompt = `Analise a tarefa do usuário: "${task}"\nContexto temporal: ${currentContext}\nResponda apenas com uma palavra: "CHAT" se for uma saudação, conversa informal ou pergunta genérica. "TASK" se for um comando técnico, solicitação de código, análise de arquivos ou tarefa de engenharia.`;
    
    let intent: string;
    try {
      const intentResponse = await this.config.llm.complete([{ 
          role: 'system', 
          content: 'Você é um classificador de intenções. Responda apenas "CHAT" ou "TASK".',
          timestamp: new Date().toISOString()
      }, { 
          role: 'user', 
          content: intentPrompt,
          timestamp: new Date().toISOString()
      }], { ...this.config.llmConfig, temperature: 0 });

      intent = intentResponse.content.trim().toUpperCase();
      intentSpan?.setAttributes({ 'orchestrator.intent': intent });
      intentSpan?.end();
    } catch (error) {
      intentSpan?.setStatus({ code: 2, message: String(error) });
      intentSpan?.end();
      throw error;
    }

    if (intent.includes('CHAT')) {
        this.notify({ type: 'phase_start', phase: 'Chat' });
        logger?.logEvent(state.id, 'phase_started', { phase: 'Chat' });
        
        // ECONOMIA DE TOKENS: Para Chat, não precisamos de todas as ferramentas de dev
        const chatRegistry = new ToolRegistry();
        // O ReActAgent precisa do complete_task para finalizar
        chatRegistry.register(this.config.registry.get('complete_task')!);

        const chatAgent = new ReActAgent({
            ...this.liveConfig,
            registry: chatRegistry, // Registry enxuto = prompt minúsculo
            llmConfig: {
                ...this.config.llmConfig,
                systemPrompt: `Você é um assistente amigável. Contexto temporal: ${currentContext}. Responda à saudação ou pergunta do usuário em Português (PT-BR) de forma natural e depois use complete_task para encerrar a interação.`
            }
        });

        const chatState = await chatAgent.run(task, undefined, orchestratorSpan);
        this.totalUsage.totalTokens = chatState.metadata.totalTokensUsed || 0;
        this.notify({ type: 'usage_update', usage: this.totalUsage });
        
        // Extrair e exibir a resposta final no quadro verde
        const lastMsg = chatState.messages.filter(m => m.role === 'assistant').at(-1)?.content || '';
        let summary = 'Olá! Como posso ajudar hoje?';

        // 1. Tentar pegar o resumo da finalização do estado (mais confiável)
        const completionEvent = chatState.eventHistory.find(e => e.type === 'task_completed');
        if (completionEvent?.reason) {
            summary = completionEvent.reason;
        } else {
            // 2. Tentar extrair do JSON da última mensagem
            try {
                const parsed = LLMResponseParser.parse(lastMsg);
                if (parsed.finalResponse) {
                    summary = parsed.finalResponse.summary;
                } else {
                    // 3. Fallback para extração manual se o parser não pegou como final
                    const clean = lastMsg.replace(/<\|[\s\S]*?\|>/g, '').replace(/```json|```/g, '').trim();
                    if (clean.startsWith('{')) {
                        const jsonObj = JSON.parse(clean);
                        summary = jsonObj.summary || jsonObj.final?.summary || jsonObj.thought || clean;
                    } else {
                        summary = clean || lastMsg;
                    }
                }
            } catch {
                summary = lastMsg.replace(/<\|[\s\S]*?\|>/g, '').trim() || lastMsg;
            }
        }

        // Limpeza final: se o resumo for apenas JSON ou tags, tenta limpar
        summary = summary.replace(/<\|[\s\S]*?\|>/g, '').trim();
        if (summary.startsWith('{') && summary.includes('"summary"')) {
            try {
                const p = JSON.parse(summary);
                summary = p.summary || summary;
            } catch {}
        }

        this.notify({ type: 'message_added', role: 'assistant', content: `RESUMO FINAL: ${summary}` });
        this.notify({ type: 'phase_complete', phase: 'Finalized' });
        logger?.logEvent(state.id, 'phase_completed', { phase: 'Chat', summary });
        
        orchestratorSpan?.end();
        return { state: chatState };
    }

    // --- FLUXO NORMAL DE TAREFA ---
    this.notify({ type: 'phase_start', phase: 'Research' });
    this.notify({ type: 'message_added', role: 'system', content: 'Iniciando fase de pesquisa...' });
    logger?.logEvent(state.id, 'phase_started', { phase: 'Research' });
    
    const researchSpan = tracing?.startPhaseSpan('Research', orchestratorSpan);
    const researchResult = await this.researchAgent.run(task, undefined, researchSpan);
    const postResearchState = researchResult.state;
    const brief = researchResult.brief;

    this.updateUsage(postResearchState);

    if (!brief) {
      const error = postResearchState.status === 'error' ? postResearchState.metadata.errorMessage : 'Falha ao gerar ResearchBrief.';
      state = AgentStateMachine.fail(postResearchState, error || 'Erro desconhecido na pesquisa');
      this.notify({ type: 'error', message: error || 'Erro desconhecido na pesquisa' });
      
      researchSpan?.setStatus({ code: 2, message: error || 'Research brief missing' });
      researchSpan?.end();
      orchestratorSpan?.setStatus({ code: 2, message: 'Orchestration failed in Research phase' });
      orchestratorSpan?.end();
      
      return { state };
    }

    this.notify({ type: 'message_added', role: 'system', content: 'Pesquisa concluída com sucesso.' });
    this.notify({ type: 'phase_complete', phase: 'Research' });
    logger?.logEvent(state.id, 'phase_completed', { phase: 'Research' });
    researchSpan?.end();

    this.notify({ type: 'phase_start', phase: 'Planning' });
    this.notify({ type: 'message_added', role: 'system', content: 'Iniciando planejamento da tarefa...' });
    logger?.logEvent(state.id, 'phase_started', { phase: 'Planning' });

    const planningSpan = tracing?.startPhaseSpan('Planning', orchestratorSpan);
    const planningResult = await this.planningAgent.run(task, brief, undefined, planningSpan);
    const postPlanningState = planningResult.state;
    const plan = planningResult.plan;

    this.totalUsage.totalTokens += postPlanningState.metadata.totalTokensUsed || 0;
    this.notify({ type: 'usage_update', usage: this.totalUsage });

    if (!plan) {
      const error = postPlanningState.status === 'error' ? postPlanningState.metadata.errorMessage : 'Falha ao gerar ExecutionPlan.';
      state = AgentStateMachine.fail(postPlanningState, error || 'Erro desconhecido no planejamento');
      this.notify({ type: 'error', message: error || 'Erro desconhecido no planejamento' });
      
      planningSpan?.setStatus({ code: 2, message: error || 'Execution plan missing' });
      planningSpan?.end();
      orchestratorSpan?.setStatus({ code: 2, message: 'Orchestration failed in Planning phase' });
      orchestratorSpan?.end();
      
      return { state };
    }

    this.notify({ type: 'message_added', role: 'system', content: 'Plano de execução gerado.' });
    this.notify({ type: 'phase_complete', phase: 'Planning' });
    logger?.logEvent(state.id, 'phase_completed', { phase: 'Planning', risk: plan.estimatedRisk });
    planningSpan?.end();

    this.notify({ type: 'phase_start', phase: 'Execution' });
    logger?.logEvent(state.id, 'phase_started', { phase: 'Execution', streamCount: plan.streams.length });
    const executionSpan = tracing?.startPhaseSpan('Execution', orchestratorSpan);

    const streamResults = await this.executePlanStreams(state, plan, brief, executionSpan);

    const firstError = streamResults.find(
      (result): result is { streamId: string; error: string } => typeof result.error === 'string'
    );
    if (firstError) {
        state = AgentStateMachine.fail(state, firstError.error);
        executionSpan?.setStatus({ code: 2, message: firstError.error });
        executionSpan?.end();
        orchestratorSpan?.setStatus({ code: 2, message: 'Execution failed in one or more streams' });
        orchestratorSpan?.end();
        return { state, plan };
    }

    executionSpan?.end();
    state = AgentStateMachine.complete(state, 'Orquestração finalizada com sucesso.');
    this.notify({ type: 'message_added', role: 'system', content: '=== TAREFA FINALIZADA ===' });
    this.notify({ type: 'phase_complete', phase: 'Finalized' });
    logger?.logEvent(state.id, 'orchestrator_completed', { status: 'success' });
    
    orchestratorSpan?.setStatus({ code: 1 });
    orchestratorSpan?.end();
    
    return { state, plan };
  }

  private async executePlanStreams(
    state: AgentState,
    plan: ExecutionPlan,
    brief: ResearchBrief,
    executionSpan?: ReturnType<NonNullable<ReActConfig['tracing']>['startPhaseSpan']>
  ): Promise<Array<{ streamId: string; error?: string }>> {
    const results: Array<{ streamId: string; error?: string }> = [];
    const completedStreams = new Set<string>();
    const pendingStreams = new Set(
      plan.streams.filter((stream) => stream.status === 'pending').map((stream) => stream.id)
    );

    while (pendingStreams.size > 0) {
      const readyStreams = plan.streams.filter(
        (stream) =>
          pendingStreams.has(stream.id) &&
          (stream.blockedBy ?? []).every((dependencyId) => completedStreams.has(dependencyId))
      );

      if (readyStreams.length === 0) {
        const unresolved = plan.streams
          .filter((stream) => pendingStreams.has(stream.id))
          .map((stream) => `${stream.id}${stream.blockedBy?.length ? ` <- ${stream.blockedBy.join(', ')}` : ''}`);
        return [
          ...results,
          {
            streamId: 'dependency-resolution',
            error: `Execution plan has unresolved or cyclic blockedBy dependencies: ${unresolved.join('; ')}`,
          },
        ];
      }

      for (const stream of readyStreams) {
        const result = await this.executeStream(state, plan, brief, stream, executionSpan);
        results.push(result);
        pendingStreams.delete(stream.id);

        if (result.error) {
          return results;
        }

        completedStreams.add(stream.id);
      }
    }

    return results;
  }

  private async executeStream(
    state: AgentState,
    plan: ExecutionPlan,
    brief: ResearchBrief,
    stream: ExecutionStream,
    executionSpan?: ReturnType<NonNullable<ReActConfig['tracing']>['startPhaseSpan']>
  ): Promise<{ streamId: string; error?: string }> {
    const logger = this.config.logger;
    const tracing = this.config.tracing;
    const streamSpan = tracing?.startPhaseSpan(`Stream: ${stream.name}`, executionSpan);
    const specializedPrompt = this.getSpecializedPrompt(stream.owner);

    this.notify({ type: 'message_added', role: 'system', content: `Executando: ${stream.name}` });
    logger?.logEvent(state.id, 'stream_started', { streamId: stream.id, streamName: stream.name });
    stream.status = 'in_progress';

    let workspaceDir: string | undefined;
    try {
      workspaceDir = await this.workspaceManager.createLease(stream.id);
      const workerRegistry = createDevelopmentToolRegistry({ workspaceRoot: workspaceDir });
      const workerAgent = new ReActAgent({
        ...this.liveConfig,
        registry: workerRegistry,
        llmConfig: {
          ...this.config.llmConfig,
          systemPrompt:
            (this.config.llmConfig?.systemPrompt || '') +
            `\n\n### CONTEXTO DE PESQUISA\n${JSON.stringify(brief, null, 2)}\n` +
            `### PLANO DE EXECUCAO\n${plan.summary}\n` +
            `\n\n${specializedPrompt}` +
            `\n\nSua missao e executar as tarefas acima.` +
            `\n\nREGRAS CRITICAS DE IDIOMA E SAIDA:` +
            `\n1. VOCE DEVE FALAR EXCLUSIVAMENTE EM PORTUGUES (PT-BR).` +
            `\n2. TODOS OS SEUS PENSAMENTOS ('thought') E RESUMOS ('summary') DEVEM SER EM PORTUGUES.` +
            `\n3. NAO USE INGLES, MESMO QUE AS FERRAMENTAS RETORNEM TEXTO EM INGLES.` +
            `\n4. PARA FINALIZAR, USE A FERRAMENTA 'complete_task' E ESCREVA O RESUMO EM PORTUGUES.` +
            `\n5. USE SEMPRE OS CAMINHOS EXATOS RETORNADOS PELAS FERRAMENTAS. NAO ADICIONE NEM REMOVA PREFIXOS DE DIRETORIO.`,
        },
      });

      const workerState = await workerAgent.run(
        `Stream ${stream.id} tasks:\n- ${stream.tasks.join('\n- ')}`,
        undefined,
        streamSpan
      );
      this.totalUsage.totalTokens += workerState.metadata.totalTokensUsed || 0;
      this.notify({ type: 'usage_update', usage: this.totalUsage });

      if (workerState.status === 'completed') {
        if (workspaceDir !== this.workspaceRoot) {
          await this.workspaceManager.releaseLease(stream.id, true);
        }

        stream.status = 'completed';
        const summary = this.extractWorkerSummary(workerState);
        this.notify({ type: 'message_added', role: 'assistant', content: `RESUMO FINAL: ${summary}` });
        logger?.logEvent(state.id, 'stream_completed', { streamId: stream.id, status: 'completed' });
        streamSpan?.end();
        return { streamId: stream.id };
      }

      if (workspaceDir !== this.workspaceRoot) {
        await this.workspaceManager.releaseLease(stream.id, false);
      }

      stream.status = 'failed';
      const errorMessage = workerState.metadata.errorMessage ?? 'Falha desconhecida na execucao do stream.';
      this.notify({ type: 'error', message: `Falha na execucao: ${errorMessage}` });
      logger?.logEvent(state.id, 'stream_failed', { streamId: stream.id, error: errorMessage });
      streamSpan?.setStatus({ code: 2, message: errorMessage });
      streamSpan?.end();
      return { streamId: stream.id, error: `Erro no stream ${stream.id}: ${errorMessage}` };
    } catch (error) {
      if (workspaceDir && workspaceDir !== this.workspaceRoot) {
        try {
          await this.workspaceManager.releaseLease(stream.id, false);
        } catch {
          // Best-effort cleanup: keep the original infrastructure error as the primary failure.
        }
      }

      stream.status = 'failed';
      const message = error instanceof Error ? error.message : String(error);
      this.notify({ type: 'error', message: `Erro de infraestrutura no stream ${stream.id}: ${message}` });
      streamSpan?.setStatus({ code: 2, message });
      streamSpan?.end();
      return { streamId: stream.id, error: message };
    }
  }

  private extractWorkerSummary(state: AgentState): string {
    const completionResult = state.toolHistory.find((entry) => entry.call.toolName === 'complete_task')?.result;
    const completionData = completionResult?.data as { summary?: unknown } | undefined;

    if (completionData && typeof completionData === 'object' && !Array.isArray(completionData)) {
      const summary = completionData.summary;
      if (typeof summary === 'string' && summary.trim().length > 0) {
        return summary;
      }
    }

    const lastAssistantMessage = state.messages.filter((message) => message.role === 'assistant').at(-1)?.content || '';
    try {
      const cleanJson = lastAssistantMessage.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanJson) as {
        arguments?: { summary?: string };
        summary?: string;
        final?: { summary?: string };
        thought?: string;
      };
      return parsed.arguments?.summary || parsed.summary || parsed.final?.summary || parsed.thought || 'Finalizado.';
    } catch {
      return lastAssistantMessage.length > 20 ? lastAssistantMessage : 'Finalizado.';
    }
  }

  public resolveApproval(approved: boolean) {
    if (this.approvalResolver) {
        this.approvalResolver(approved);
        this.approvalResolver = undefined;
    }
  }

  private getSpecializedPrompt(role: string): string {
    switch (role.toLowerCase()) {
      case 'coder': return CODER_PROMPT;
      case 'reviewer': return REVIEWER_PROMPT;
      case 'tester':
      case 'test': return TESTER_PROMPT;
      case 'debug': return DEBUG_PROMPT;
      default: return `Você é um agente especializado em ${role}.`;
    }
  }
}
