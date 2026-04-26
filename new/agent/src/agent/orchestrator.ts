import { ReActAgent, ReActConfig } from './react-loop.js';
import { AgentState, ExecutionPlan, ExecutionStream, FeedbackIteration, FeedbackLoopPolicy, ResearchBrief } from '../types/index.js';
import { ResearchAgent } from './research.js';
import { PlanningAgent } from './planning.js';
import { FeedbackLoopEngine } from './feedback-loop.js';
import { AgentStateMachine } from '../state/machine.js';
import { createDevelopmentToolRegistry } from '../tools/development-tools.js';
import { RiskPolicyEngine } from '../utils/risk-engine.js';
import { 
    CODER_PROMPT, 
    DEBUG_PROMPT, 
    REVIEWER_PROMPT, 
    TESTER_PROMPT,
    SECURITY_REVIEWER_PROMPT,
    PERFORMANCE_REVIEWER_PROMPT,
    UX_REVIEWER_PROMPT,
    ERROR_HANDLING_REVIEWER_PROMPT
} from '../prompts/specialized.js';
import { WorkspaceManager } from '../code/workspace-manager.js';
import { TerminalService } from '../code/terminal-service.js';
import { HookService } from './hook-service.js';

export type OrchestratorEvent = 
  | { type: 'phase_start'; phase: string }
  | { type: 'phase_complete'; phase: string; details?: string }
  | { 
      type: 'message_added'; 
      role: string; 
      content: string; 
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      latencyMs?: number;
      contextWindow?: number;
      reasoningTokens?: number;
    }
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
  private feedbackLoop: FeedbackLoopEngine;
  private workspaceManager: WorkspaceManager;
  private workspaceRoot: string;
  private fallbackHumanApprovalCallback?: ReActConfig['humanApprovalCallback'];
  private hookService: HookService;
  private autoApprove: boolean = false;

  constructor(private config: ReActConfig, feedbackPolicy?: Partial<FeedbackLoopPolicy>) {
    const languageInstruction = "\n\nIMPORTANT: Always respond in the same language as the user's prompt. If the user speaks Portuguese, you MUST respond in Portuguese.";
    
    this.config.llmConfig = {
      ...this.config.llmConfig,
      systemPrompt: (this.config.llmConfig?.systemPrompt || '') + languageInstruction
    };

    this.workspaceRoot = (this.config.registry as { workspaceRoot?: string }).workspaceRoot || process.cwd();
    this.riskEngine = new RiskPolicyEngine(this.workspaceRoot);
    this.feedbackLoop = new FeedbackLoopEngine(feedbackPolicy);
    this.fallbackHumanApprovalCallback = this.config.humanApprovalCallback;
    this.hookService = new HookService(this.workspaceRoot);
    const terminal = new TerminalService(this.workspaceRoot, { sandboxMode: this.config.sandboxMode });
    this.workspaceManager = new WorkspaceManager(this.workspaceRoot, terminal);
    this.liveConfig = {
        ...this.config,
        onUpdate: (event) => {
            if (event.type === 'message_added') {
                this.notify({ 
                    type: 'message_added', 
                    role: event.role!, 
                    content: event.content!,
                    usage: event.usage,
                    latencyMs: event.latencyMs,
                    contextWindow: event.contextWindow,
                    reasoningTokens: event.reasoningTokens
                });
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

            if (this.autoApprove) {
                return true;
            }

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
        },
        hookService: this.hookService
    };

    this.researchAgent = new ResearchAgent(this.liveConfig);
    this.planningAgent = new PlanningAgent(this.liveConfig);
  }

  public setUpdateCallback(callback: OrchestratorUpdateCallback) {
    this.onUpdate = callback;
    this.notify({ type: 'usage_update', usage: this.totalUsage });
  }

  public setAutoApprove(approved: boolean) {
    this.autoApprove = approved;
    if (approved && this.approvalResolver) {
        this.resolveApproval(true);
    }
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

    // --- ETAPA: CLASSIFICAÇÃO DE INTENÇÃO (Otimizada para economizar tokens e tempo) ---
    const intentSpan = tracing?.startPhaseSpan('Intent Classification', orchestratorSpan);
    
    const isGreeting = /^(oi|olá|ola|hello|hi|bom dia|boa tarde|boa noite|apresente-se|quem é você)(\!|\?|\.)*$/i.test(task.trim());
    
    let intent: 'CHAT' | 'TASK' | 'DIRECT';
    if (isGreeting || task === 'Oi! Como posso te ajudar hoje?') {
      intent = 'CHAT';
    } else {
      const intentPrompt = `Analise a tarefa: "${task}"\n\nClassifique em:\n- "CHAT": Saudação ou conversa informal.\n- "DIRECT": Pergunta simples que você já sabe a resposta (ex: "como fazer build", "o que é typescript") e não precisa ler arquivos ou rodar comandos.\n- "TASK": Tarefa que exige analisar o código, criar arquivos, rodar testes ou comandos de terminal.\n\nResponda APENAS com a palavra da categoria.`;
      
      try {
        const intentResponse = await this.config.llm.complete([{ 
            role: 'system', 
            content: 'Você é um classificador de intenções rápido.',
            timestamp: new Date().toISOString()
        }, { 
            role: 'user', 
            content: intentPrompt,
            timestamp: new Date().toISOString()
        }], { ...this.config.llmConfig, temperature: 0 });

        const raw = intentResponse.content.trim().toUpperCase();
        intent = raw.includes('TASK') ? 'TASK' : raw.includes('DIRECT') ? 'DIRECT' : 'CHAT';
      } catch (error) {
        intent = 'TASK'; // Fallback seguro
      }
    }
    intentSpan?.end();

    if (intent === 'CHAT' || intent === 'DIRECT') {
        const phase = intent === 'CHAT' ? 'Chat' : 'Resposta Direta';
        this.notify({ type: 'phase_start', phase });
        
        const systemPrompt = intent === 'CHAT' 
          ? 'Você é um assistente amigável. Responda de forma natural e concisa.'
          : 'Você é um engenheiro sênior. Responda a pergunta técnica de forma direta e útil, sem usar ferramentas.';

        const chatResponse = await this.config.llm.complete([
          { role: 'system', content: systemPrompt, timestamp: new Date().toISOString() },
          { role: 'user', content: task, timestamp: new Date().toISOString() }
        ], this.config.llmConfig);

        this.totalUsage.totalTokens += chatResponse.usage.totalTokens;
        this.notify({ type: 'usage_update', usage: this.totalUsage });
        this.notify({ 
          type: 'message_added', 
          role: 'assistant', 
          content: chatResponse.content,
          usage: chatResponse.usage,
          latencyMs: chatResponse.latencyMs
        });
        
        this.notify({ type: 'message_added', role: 'assistant', content: `RESUMO FINAL: ${chatResponse.content}` });
        this.notify({ type: 'phase_complete', phase: 'Finalized' });
        
        state = AgentStateMachine.complete(state, chatResponse.content);
        return { state };
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

        if (result.error) {
          // ── Feedback Loop: attempt recovery before propagating ──
          const recovered = await this.attemptFeedbackLoop(
            state, plan, brief, stream, result.error, executionSpan
          );

          if (recovered) {
            results.push({ streamId: stream.id });
            completedStreams.add(stream.id);
          } else {
            results.push(result);
            return results;
          }
        } else {
          results.push(result);
          completedStreams.add(stream.id);
        }

        pendingStreams.delete(stream.id);
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
            `\n<context>\n<research>\n- Tipo: ${brief.taskType}\n- Entradas: ${brief.entryPoints.join(', ')}\n- Resumo: ${brief.summary}\n</research>\n<plan>${plan.summary}</plan>\n</context>\n` +
            `\n${specializedPrompt}` +
            `\n<instructions>\n- IDIOMA: PT-BR OBRIGATÓRIO (pensamentos e resumos).\n- FERRAMENTAS: Use caminhos EXATOS das ferramentas.\n- FINALIZAR: 'complete_task' com resumo em PT-BR.\n</instructions>`,
        },
      });

      const workerState = await workerAgent.run(
        `<task>Stream ${stream.id}:\n${stream.tasks.map(t => `- ${t}`).join('\n')}</task>`,
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

  /**
   * Attempt to recover a failed stream through the feedback loop.
   * Classifies the failure, creates a recovery stream, and retries
   * with the correct specialist agent up to maxRetries times.
   */
  private async attemptFeedbackLoop(
    state: AgentState,
    plan: ExecutionPlan,
    brief: ResearchBrief,
    originalStream: ExecutionStream,
    error: string,
    executionSpan?: ReturnType<NonNullable<ReActConfig['tracing']>['startPhaseSpan']>
  ): Promise<boolean> {
    const logger = this.config.logger;
    const tracing = this.config.tracing;
    const failureKind = this.feedbackLoop.classifyFromError(error);

    this.notify({
      type: 'message_added',
      role: 'system',
      content: `Feedback Loop: falha classificada como '${failureKind}' no stream "${originalStream.name}". Tentando recuperação automática...`,
    });

    while (this.feedbackLoop.shouldRetry(originalStream.id, this.totalUsage.totalTokens)) {
      const iteration = this.feedbackLoop.getIterationCount(originalStream.id) + 1;
      const recoveryStream = this.feedbackLoop.createRecoveryStream(originalStream, failureKind, error);
      const promptRole = this.feedbackLoop.getPromptRoleForFailure(failureKind);

      const feedbackSpan = tracing?.startFeedbackLoopSpan(
        originalStream.id,
        iteration,
        failureKind,
        executionSpan
      );

      this.notify({
        type: 'message_added',
        role: 'system',
        content: `Feedback Loop iteração ${iteration}/${this.feedbackLoop.getPolicy().maxRetries}: delegando para ${promptRole}...`,
      });
      logger?.logEvent(state.id, 'feedback_loop_started', {
        streamId: originalStream.id,
        iteration,
        failureKind,
        delegatedTo: promptRole,
      });

      const tokensBefore = this.totalUsage.totalTokens;

      // Execute the recovery stream using the appropriate prompt role
      const recoveryResult = await this.executeStream(
        state,
        plan,
        brief,
        { ...recoveryStream, owner: recoveryStream.owner },
        feedbackSpan
      );

      const feedbackRecord: FeedbackIteration = {
        iteration,
        failureKind,
        delegatedTo: recoveryStream.owner,
        streamId: originalStream.id,
        recoveryStreamId: recoveryStream.id,
        error: error.slice(0, 1000),
        resolved: !recoveryResult.error,
        tokensBefore,
        tokensAfter: this.totalUsage.totalTokens,
      };

      if (!recoveryResult.error) {
        feedbackRecord.resolvedAt = new Date().toISOString();
      }

      this.feedbackLoop.recordIteration(feedbackRecord);
      logger?.logFeedbackIteration(state.id, feedbackRecord);

      feedbackSpan?.setAttributes({
        'feedback_loop.resolved': feedbackRecord.resolved,
        'feedback_loop.tokens_used': (feedbackRecord.tokensAfter ?? tokensBefore) - tokensBefore,
      });
      feedbackSpan?.end();

      if (!recoveryResult.error) {
        this.notify({
          type: 'message_added',
          role: 'system',
          content: `Feedback Loop: recuperação bem-sucedida na iteração ${iteration}.`,
        });
        logger?.logEvent(state.id, 'feedback_loop_resolved', {
          streamId: originalStream.id,
          iteration,
          failureKind,
        });
        return true;
      }

      // Update error for next iteration classification
      error = recoveryResult.error;
    }

    // Exhausted retries or budget
    const iterationCount = this.feedbackLoop.getIterationCount(originalStream.id);
    const reason = this.totalUsage.totalTokens >= this.feedbackLoop.getPolicy().maxCostTokens
      ? `Feedback Loop encerrado: orçamento de tokens excedido (${this.totalUsage.totalTokens} >= ${this.feedbackLoop.getPolicy().maxCostTokens}).`
      : `Feedback Loop encerrado: máximo de ${iterationCount} tentativas atingido para stream "${originalStream.name}".`;

    this.notify({ type: 'error', message: reason });
    logger?.logEvent(state.id, 'feedback_loop_exhausted', {
      streamId: originalStream.id,
      iterations: iterationCount,
      failureKind,
      reason,
      patterns: this.feedbackLoop.getFailurePatterns(),
    });

    return false;
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
      case 'security_reviewer': return SECURITY_REVIEWER_PROMPT;
      case 'performance_reviewer': return PERFORMANCE_REVIEWER_PROMPT;
      case 'ux_reviewer': return UX_REVIEWER_PROMPT;
      case 'error_reviewer': return ERROR_HANDLING_REVIEWER_PROMPT;
      case 'tester':
      case 'test': return TESTER_PROMPT;
      case 'debug': return DEBUG_PROMPT;
      default: return `Você é um agente especializado em ${role}.`;
    }
  }
}
