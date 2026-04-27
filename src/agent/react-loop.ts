import { Span } from '@opentelemetry/api';
import {
  AgentState,
  AgentStatus,
  JsonValue,
  LLMConfig,
  LLMResponse,
  PersonaStyle,
  ToolBudget,
  ToolCall,
  ToolResult,
} from '../types/index.js';
import { ContextManager } from '../context/manager.js';
import { LLMAdapter, LLMResponseParser } from '../llm/adapter.js';
import { TracingService } from '../observability/tracing.js';
import { UnifiedLogger } from '../observability/logger.js';
import { CheckpointManager } from '../state/checkpoint.js';
import { AgentStateMachine } from '../state/machine.js';
import { ExecutorConfig, ToolExecutor, ToolExecutorHooks } from '../tools/executor.js';
import { ToolRegistry } from '../tools/registry.js';
import { HookService } from './hook-service.js';

import { SandboxMode } from '../code/sandbox-executor.js';
import { estimateTokensFromText } from '../utils/json.js';

export interface ReActConfig {
  llm: LLMAdapter;
  registry: ToolRegistry;
  checkpointManager: CheckpointManager;
  contextManager: ContextManager;
  tracing?: TracingService;
  logger?: UnifiedLogger;
  llmConfig?: Partial<LLMConfig>;
  executorConfig?: Partial<ExecutorConfig>;
  executorHooks?: ToolExecutorHooks;
  humanApprovalCallback?: (toolCall: ToolCall, reason: string) => Promise<boolean>;
  humanApprovalPolicy?: (toolCall: ToolCall, state: AgentState) => string | undefined;
  onUpdate?: (event: {
    type: string;
    role?: string;
    content?: string;
    message?: string;
    usage?: any;
    latencyMs?: number;
    contextWindow?: number;
    reasoningTokens?: number;
  }) => void;
  hookService?: HookService;
  personaStyle?: PersonaStyle;
  sandboxMode?: SandboxMode;
  /** Budget limits for this agent (tool calls, tokens, cost). Defaults to 'default' preset. */
  toolBudget?: Partial<ToolBudget>;
}

export interface VerificationResult {
  terminal: boolean;
  state: AgentState;
}

export class ReActAgent {
  private readonly executor: ToolExecutor;
  private readonly budget: ToolBudget;
  private budgetUsed = { calls: 0, tokens: 0, costUsd: 0 };

  constructor(private readonly config: ReActConfig) {
    this.budget = {
      maxToolCalls: config.toolBudget?.maxToolCalls ?? 50,
      maxTokens: config.toolBudget?.maxTokens ?? 100_000,
      maxCostUsd: config.toolBudget?.maxCostUsd ?? 0.50,
    };
    this.executor = new ToolExecutor(
      config.registry,
      config.executorConfig,
      this.buildTracedHooks(config.executorHooks)
    );
  }

  /** Wrap user-provided hooks with tracing spans for tool calls. */
  private buildTracedHooks(userHooks?: ToolExecutorHooks): ToolExecutorHooks {
    const tracing = this.config.tracing;
    const logger = this.config.logger;
    if (!tracing && !logger) return userHooks ?? {};

    const spanMap = new Map<string, Span>();

    return {
      ...userHooks,
      onToolStart: async (toolCall, attempt) => {
        if (attempt === 1) {
          const span = tracing?.startToolSpan(toolCall.toolName, toolCall.id);
          if (span) spanMap.set(toolCall.id, span);
        }
        await userHooks?.onToolStart?.(toolCall, attempt);
      },
      onToolRetry: async (toolCall, attempt, error, delayMs) => {
        const span = spanMap.get(toolCall.id);
        span?.addEvent('retry', {
          'retry.attempt': attempt,
          'retry.error': error.message,
          'retry.delay_ms': delayMs,
        });
        await userHooks?.onToolRetry?.(toolCall, attempt, error, delayMs);
      },
      onToolSuccess: async (toolCall, result) => {
        const span = spanMap.get(toolCall.id);
        if (span) {
          tracing?.recordToolResult(span, result);
          spanMap.delete(toolCall.id);
        }
        // Assuming we pass state somehow or we don't have it here...
        // Wait, the hook doesn't have state.id, but we can log using toolCall.id or agent id if we bind it.
        // Actually, we don't have agentId here easily since ToolExecutor is global for the agent instance.
        // ReActAgent doesn't know the state.id in the constructor.
        // Let's defer logger for tools to act().
        await userHooks?.onToolSuccess?.(toolCall, result);
      },
      onToolFailure: async (toolCall, result) => {
        const span = spanMap.get(toolCall.id);
        if (span) {
          tracing?.recordToolResult(span, result);
          spanMap.delete(toolCall.id);
        }
        await userHooks?.onToolFailure?.(toolCall, result);
      },
      onRollback: async (toolCall, rollbackResult) => {
        const span = spanMap.get(toolCall.id);
        span?.addEvent('rollback', {
          'rollback.attempted': rollbackResult.attempted,
          'rollback.success': rollbackResult.success,
        });
        await userHooks?.onRollback?.(toolCall, rollbackResult);
      },
      onPreExecute: async (toolCall) => {
        if (!this.config.hookService) return undefined;

        const evaluations = this.config.hookService.evaluate('pre_tool', toolCall.toolName, toolCall.arguments);
        const blocked = this.config.hookService.isBlocked(evaluations);

        if (blocked) {
          return {
            toolCallId: toolCall.id,
            success: false,
            data: null,
            error: `Action blocked by rule "${blocked.ruleId}": ${blocked.message}`,
            durationMs: 0,
            timestamp: new Date().toISOString(),
            attempts: 0,
            timedOut: false,
            recoverable: false,
            errorCode: 'CRITICAL_ERROR'
          };
        }

        const warnings = evaluations.filter(e => e.action === 'warn');
        for (const warn of warnings) {
          this.config.onUpdate?.({ type: 'message_added', role: 'system', content: `⚠️ AVISO: Regra "${warn.ruleId}" disparada: ${warn.message}` });
        }

        return undefined;
      },
      onPostExecute: async (toolCall, result) => {
        if (!this.config.hookService || !result.success) return undefined;

        const evaluations = this.config.hookService.evaluate('post_tool', toolCall.toolName, result.data);
        const blocked = this.config.hookService.isBlocked(evaluations);

        if (blocked) {
          return {
            toolCallId: toolCall.id,
            success: false,
            data: result.data, // Keep data for context
            error: `Result blocked by rule "${blocked.ruleId}": ${blocked.message}`,
            durationMs: result.durationMs,
            timestamp: new Date().toISOString(),
            attempts: result.attempts,
            timedOut: false,
            recoverable: false,
            errorCode: 'CRITICAL_ERROR'
          };
        }

        const warnings = evaluations.filter(e => e.action === 'warn');
        for (const warn of warnings) {
          this.config.onUpdate?.({ type: 'message_added', role: 'system', content: `⚠️ AVISO (Pós-ação): Regra "${warn.ruleId}" disparada: ${warn.message}` });
        }

        return undefined;
      }
    };
  }

  async run(task: string, existingState?: AgentState, parentSpan?: Span): Promise<AgentState> {
    let state = existingState ?? AgentStateMachine.create(task);
    const agentSpan = this.config.tracing?.startAgentSpan(task, state.id, parentSpan);
    await this.config.checkpointManager.checkpoint(state);

    try {
      while (!this.isTerminal(state.status)) {
        // ── Budget Enforcement ──
        const budgetExceeded = this.checkBudget();
        if (budgetExceeded) {
          state = AgentStateMachine.fail(state, budgetExceeded);
          this.config.logger?.logEvent(state.id, 'budget_exceeded', {
            reason: budgetExceeded,
            used: { ...this.budgetUsed },
            limit: { ...this.budget },
          });
          break;
        }
        if (state.status === 'awaiting_human') {
          state = await this.handlePendingHumanApproval(state);
          await this.config.checkpointManager.checkpoint(state);
          if (state.status === 'awaiting_human') {
            agentSpan?.addEvent('awaiting_human');
            return state;
          }
        }

        state = AgentStateMachine.incrementIteration(state);
        if (state.status === 'error') {
          break;
        }

        state = await this.observe(state);
        const response = await this.think(state);
        state = response.state;

        if (response.llmResponse.parseError) {
          state = this.addRecoverableParserError(state, response.llmResponse.parseError);
          state = AgentStateMachine.dispatch(state, {
            type: 'verification_started',
            reason: 'LLM response parse error',
          });
          await this.config.checkpointManager.checkpoint(state);
          continue;
        }

        if (response.llmResponse.finalResponse) {
          state =
            response.llmResponse.finalResponse.status === 'success'
              ? AgentStateMachine.complete(state, response.llmResponse.finalResponse.summary)
              : AgentStateMachine.fail(state, response.llmResponse.finalResponse.summary);
          break;
        }


        const toolCalls = response.llmResponse.toolCalls ?? [];
        if (toolCalls.length === 0) {
          // Instead of auto-completing, we warn the model that it must use a tool or complete_task.
          // This prevents "lazy" models or conversational models from finishing prematurely.
          const verification = this.verify(state);
          state = verification.state;
          if (verification.terminal) {
            await this.config.checkpointManager.checkpoint(state);
            break;
          }
          state = AgentStateMachine.addMessage(state, {
            role: 'system',
            content: 'Você não forneceu nenhuma chamada de ferramenta estruturada em JSON. Relembre o contrato: { "thought": "sua explicação", "tool": "nome_da_ferramenta", "arguments": { ... } }. Se você terminou, use a ferramenta de finalização apropriada (ex: submit_research_brief ou complete_task). Caso contrário, continue usando as ferramentas para progredir.',
            timestamp: new Date().toISOString(),
          });

          if (state.metadata.iterationCount >= (this.config.executorConfig?.maxIterations ?? 100)) {
            state = AgentStateMachine.fail(state, 'Máximo de iterações atingido sem conclusão ou uso de ferramentas.');
            break;
          }
          await this.config.checkpointManager.checkpoint(state);
          continue;
        }

        state = await this.act(state, toolCalls);
        const verification = this.verify(state);
        state = verification.state;
        await this.config.checkpointManager.checkpoint(state);
        if (verification.terminal) {
          break;
        }

        if (state.status === 'awaiting_human') {
          return state;
        }

      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state = AgentStateMachine.fail(state, message);
    }

    agentSpan?.setAttributes({
      'agent.status': state.status,
      'agent.iterations': state.metadata.iterationCount,
      'agent.total_tokens': state.metadata.totalTokensUsed,
      'agent.tool_calls': state.toolHistory.length,
    });
    agentSpan?.end();

    await this.config.checkpointManager.checkpoint(state);
    return state;
  }

  async resume(agentId: string, parentSpan?: Span): Promise<AgentState> {
    const state = await this.config.checkpointManager.resumeFromCheckpoint(agentId);
    if (!state) {
      throw new Error(`Checkpoint ${agentId} not found`);
    }

    if (!state.currentTask) {
      throw new Error('Restored state does not have a current task');
    }

    return this.run(state.currentTask, state, parentSpan);
  }

  private async observe(state: AgentState): Promise<AgentState> {
    const next =
      state.status === 'idle'
        ? AgentStateMachine.dispatch(state, { type: 'task_started', reason: state.currentTask ?? undefined })
        : state;
    await this.config.checkpointManager.checkpoint(next);
    return next;
  }

  private async think(state: AgentState): Promise<{ state: AgentState; llmResponse: LLMResponse }> {
    const thinkingState =
      state.status === 'observing'
        ? AgentStateMachine.dispatch(state, { type: 'thought_started' })
        : state;
    const messages = this.config.contextManager.prepareMessages(thinkingState, this.buildSystemPrompt());

    const llmSpan = this.config.tracing?.startLLMSpan(
      'mock',
      this.config.llmConfig?.model ?? 'default',
      'general'
    );

    let llmResponse: LLMResponse;
    try {
      // Injetamos um lembrete de idioma ao final para garantir que o modelo não se perca no contexto
      const languageReminder = "RELEMBRE: Responda SEMPRE em PORTUGUÊS (PT-BR). Use apenas ferramentas e NÃO invente o comando 'final'.";
      const messagesWithReminder = [...messages, {
        role: 'system' as const,
        content: languageReminder,
        timestamp: new Date().toISOString()
      }];

      let rawResponse: LLMResponse;
      if (this.config.llm.stream) {
        let fullContent = '';
        const startedAt = Date.now();
        
        for await (const chunk of this.config.llm.stream(messagesWithReminder, this.config.llmConfig)) {
          fullContent += chunk;
          this.config.onUpdate?.({
            type: 'thought_chunk',
            content: chunk,
          });
        }

        const promptTokens = messagesWithReminder.reduce((acc, m) => acc + estimateTokensFromText(m.content), 0);
        const completionTokens = estimateTokensFromText(fullContent);

        rawResponse = {
          content: fullContent,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          },
          latencyMs: Date.now() - startedAt,
        };
      } else {
        rawResponse = await this.config.llm.complete(messagesWithReminder, this.config.llmConfig);
      }

      llmResponse = this.normalizeLLMResponse(rawResponse);
      if (llmSpan) {
        this.config.tracing?.recordLLMUsage(llmSpan, llmResponse.usage);
      }
      this.config.logger?.logLLMResponse(
        state.id,
        this.config.llmConfig?.model ?? 'default',
        this.config.llmConfig?.model ?? 'default',
        llmResponse.usage,
        undefined,
        undefined
      );

      // Log event with full content for debugging
      this.config.logger?.logEvent(state.id, 'llm_content_debug', {
        content: llmResponse.content.slice(0, 2000)
      });

      if (llmResponse.finishReason === 'length') {
        const errorMsg = '⚠️ LIMITE DE CONTEXTO ATINGIDO: O modelo cortou a resposta por falta de espaço. Tente aumentar o n_ctx no LM Studio ou limpar o histórico.';
        this.config.onUpdate?.({ type: 'error', message: errorMsg });
        this.config.logger?.logEvent(state.id, 'context_limit_reached', { tokens: llmResponse.usage.totalTokens });
      }
    } catch (error) {
      if (llmSpan) {
        this.config.tracing?.recordLLMError(llmSpan, error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }

    let next = AgentStateMachine.addTokenUsage(thinkingState, llmResponse.usage.totalTokens);
    
    // Track budget usage
    this.budgetUsed.tokens += llmResponse.usage.totalTokens;
    this.budgetUsed.costUsd += 0; // Cost tracked separately per provider
    
    next = AgentStateMachine.addMessage(next, {
      role: 'assistant',
      content: llmResponse.content,
      toolCalls: llmResponse.toolCalls,
      timestamp: new Date().toISOString(),
    });

    this.config.onUpdate?.({
      type: 'message_added',
      role: 'assistant',
      content: llmResponse.content,
      usage: llmResponse.usage,
      latencyMs: llmResponse.latencyMs,
      contextWindow: this.config.llmConfig?.contextWindow
    });

    await this.config.checkpointManager.checkpoint(next);
    return { state: next, llmResponse };
  }

  private async act(state: AgentState, toolCalls: ToolCall[]): Promise<AgentState> {
    let next =
      state.status === 'thinking'
        ? AgentStateMachine.dispatch(state, {
          type: 'tool_call_started',
          toolCallId: toolCalls[0]?.id,
        })
        : state;

    for (const toolCall of toolCalls) {
      const approvalReason = this.getHumanApprovalReason(next, toolCall);
      if (approvalReason) {
        if (approvalReason.startsWith('BLOCKED:')) {
          next = AgentStateMachine.fail(next, `Action blocked by security policy: ${approvalReason.replace('BLOCKED: ', '')}`);
          this.config.onUpdate?.({ type: 'error', message: `Acao bloqueada por politica de seguranca: ${approvalReason}` });
          return next;
        }
        next = AgentStateMachine.requestHumanApproval(next, toolCall, approvalReason);
        await this.config.checkpointManager.checkpoint(next);

        if (!this.config.humanApprovalCallback) {
          return next;
        }

        next = await this.resolveHumanApproval(next, approvalReason);
        if (next.status !== 'acting') {
          return next;
        }
      }

      const result = await this.executor.execute(next, toolCall);
      
      // Track tool call in budget
      this.budgetUsed.calls++;
      this.config.logger?.logToolExecution(next.id, toolCall.toolName, toolCall.id, result);
      next = this.recordToolResult(next, toolCall, result);
    }

    if (next.status === 'acting') {
      next = AgentStateMachine.dispatch(next, {
        type: 'tool_call_finished',
        toolCallId: toolCalls.at(-1)?.id,
      });
    }

    return next;
  }

  private verify(state: AgentState): VerificationResult {
    const lastMessage = state.messages.at(-1);
    const isEmptyResponse = lastMessage?.role === 'assistant' &&
      (!lastMessage.content?.trim() || lastMessage.content === 'Processando...') &&
      (!lastMessage.toolCalls || lastMessage.toolCalls.length === 0);

    if (isEmptyResponse) {
      const recentEmpty = state.messages.slice(-10).filter(m =>
        m.role === 'assistant' && (!m.content?.trim() || m.content === 'Processando...') && (!m.toolCalls || m.toolCalls.length === 0)
      ).length;

      const correction = "Você retornou uma resposta vazia sem chamar nenhuma ferramenta. Se você concluiu a tarefa, use 'complete_task'. Se precisar de mais informações, use as ferramentas de busca ou leitura.";
      const next = AgentStateMachine.addMessage(state, {
        role: 'system',
        content: correction,
        timestamp: new Date().toISOString(),
      });

      if (recentEmpty >= 3) {
        return {
          terminal: true,
          state: AgentStateMachine.fail(state, "A IA está retornando respostas vazias repetidamente. Verifique a configuração do modelo local ou o limite de contexto."),
        };
      }

      return { terminal: false, state: next };
    }

    // if (AgentStateMachine.isStuck(state)) {
    //   return {
    //     terminal: true,
    //     state: AgentStateMachine.fail(state, 'Repeated identical tool calls detected'),
    //   };
    // }

    // Detect failure loops (e.g. the LLM keeps sending empty query to search_text)
    const failureLoop = AgentStateMachine.detectFailureLoop(state);
    if (failureLoop) {
      const lastFailed = state.toolHistory.at(-1);
      const toolName = lastFailed?.call.toolName ?? 'unknown';
      const failedArgs = JSON.stringify(lastFailed?.call.arguments ?? {});
      const correctionMessage =
        `ERRO REPETIDO DETECTADO: Você chamou a ferramenta "${toolName}" múltiplas vezes com os mesmos argumentos inválidos: ${failedArgs}. ` +
        `Erro: ${failureLoop}. ` +
        `VOCÊ DEVE ALTERAR SUA ABORDAGEM. Opções:` +
        `\n1. Use argumentos DIFERENTES e VÁLIDOS (ex: query não pode ser vazio).` +
        `\n2. Use uma ferramenta DIFERENTE (ex: list_files, read_file, git_status).` +
        `\n3. Se não tem informação suficiente, use 'complete_task' com status 'failure' e explique o problema.` +
        `\nNÃO repita a mesma chamada com os mesmos argumentos.`;

      // Terminate on any repeated failure loop (same args, same failure)
      return {
        terminal: true,
        state: AgentStateMachine.fail(state, `Repeated failure loop detected: ${failureLoop}`),
      };

      const next = AgentStateMachine.addMessage(state, {
        role: 'system',
        content: correctionMessage,
        timestamp: new Date().toISOString(),
      });
      return { terminal: false, state: next };
    }

    const lastExecution = state.toolHistory.at(-1);
    if (!lastExecution) {
      return { terminal: false, state };
    }

    if (lastExecution.result.success) {
      const data = lastExecution.result.data;
      const completedFlag = extractCompletedFlag(data);

      if (completedFlag === true) {
        if (lastExecution.call.toolName === 'complete_task') {
          const summary = extractSummary(data) ?? 'Task completed through complete_task.';
          const completionStatus = extractCompletionStatus(data);
          return {
            terminal: true,
            state:
              completionStatus === 'failure'
                ? AgentStateMachine.fail(state, summary)
                : AgentStateMachine.complete(state, summary),
          };
        }

        return {
          terminal: true,
          state: AgentStateMachine.complete(
            state,
            extractSummary(data) ?? 'Task completed through specialized completion tool.'
          ),
        };
      }

      // NOVO: Verificar se é um pedido de interação humana (ask_user)
      if (typeof data === 'object' && data !== null && !Array.isArray(data) && (data as any).pending_human === true) {
        const question = (data as any).question || 'O agente precisa de sua ajuda.';
        return {
          terminal: false,
          state: AgentStateMachine.requestHumanApproval(state, lastExecution.call, question)
        };
      }

      if (lastExecution.call.toolName === 'complete_task') {
        const blockedSummary =
          extractSummary(data) ??
          extractErrorMessage(data) ??
          'Task completion was blocked by validation.';
        const next = AgentStateMachine.addMessage(state, {
          role: 'system',
          content: `Completion gate blocked finalize step: ${blockedSummary}`,
          timestamp: new Date().toISOString(),
        });
        return { terminal: false, state: next };
      }
    }

    if (!lastExecution.result.success && !lastExecution.result.recoverable) {
      return {
        terminal: true,
        state: AgentStateMachine.fail(state, lastExecution.result.error ?? 'Non-recoverable tool failure'),
      };
    }

    let next = state;
    if (lastExecution.result.success && isSuspiciouslyEmpty(lastExecution.result.data)) {
      next = AgentStateMachine.addMessage(next, {
        role: 'system',
        content: `Verification warning: ${lastExecution.call.toolName} returned an empty result. Confirm whether this is expected before proceeding.`,
        timestamp: new Date().toISOString(),
      });
    }

    return { terminal: false, state: next };
  }

  private async handlePendingHumanApproval(state: AgentState): Promise<AgentState> {
    const pending = state.pendingHumanApproval;
    if (!pending || pending.resolved) {
      return state;
    }

    if (!this.config.humanApprovalCallback) {
      return state;
    }

    return this.resolveHumanApproval(state, pending.reason);
  }

  private async resolveHumanApproval(state: AgentState, reason: string): Promise<AgentState> {
    const pending = state.pendingHumanApproval;
    if (!pending) {
      return state;
    }

    const approved = await this.config.humanApprovalCallback?.(pending.toolCall, reason);
    const resolved = AgentStateMachine.resolveHumanApproval(
      state,
      Boolean(approved),
      approved ? 'Approved by human operator' : 'Rejected by human operator'
    );

    if (approved) {
      return resolved;
    }

    const rejectionResult: ToolResult = {
      toolCallId: pending.toolCall.id,
      success: false,
      data: null,
      error: 'Rejected by human operator',
      durationMs: 0,
      timestamp: new Date().toISOString(),
      attempts: 0,
      timedOut: false,
      recoverable: true,
      errorCode: 'HUMAN_REJECTED',
      nextActionHint: 'Explain the rejection and choose a safer alternative.',
    };

    return this.recordToolResult(resolved, pending.toolCall, rejectionResult);
  }

  private recordToolResult(state: AgentState, toolCall: ToolCall, result: ToolResult): AgentState {
    let next = AgentStateMachine.addToolExecution(state, toolCall, result);
    next = AgentStateMachine.addMessage(next, {
      role: 'tool',
      content: result.success
        ? `Tool ${toolCall.toolName} result: ${JSON.stringify(result.data)}`
        : `Tool ${toolCall.toolName} failed: ${result.error}. Next action hint: ${result.nextActionHint ?? 'Inspect and recover.'}`,
      toolResult: result,
      timestamp: new Date().toISOString(),
    });
    this.config.onUpdate?.({
      type: 'message_added',
      role: 'tool',
      content: next.messages.at(-1)?.content || ''
    });
    return next;
  }

  private addRecoverableParserError(state: AgentState, parseError: string): AgentState {
    return AgentStateMachine.addMessage(state, {
      role: 'system',
      content: `Recoverable LLM response error: ${parseError}. Respond again using the required JSON contract.`,
      timestamp: new Date().toISOString(),
    });
  }

  private normalizeLLMResponse(response: LLMResponse): LLMResponse {
    if (response.toolCalls || response.finalResponse || response.parseError) {
      return response;
    }

    const parsed = LLMResponseParser.parse(response.content);
    return {
      ...response,
      content: parsed.thought,
      toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
      finalResponse: parsed.finalResponse,
      parseError: parsed.parseError,
    };
  }

  private getHumanApprovalReason(state: AgentState, toolCall: ToolCall): string | undefined {
    const tool = this.config.registry.get(toolCall.toolName);
    if (tool?.schema.dangerous) {
      return `Tool "${toolCall.toolName}" is marked dangerous`;
    }

    return this.config.humanApprovalPolicy?.(toolCall, state);
  }

  private buildSystemPrompt(): string {
    const now = new Date();
    const days = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    const dayName = days[now.getDay()];
    const dateStr = now.toLocaleDateString('pt-BR');
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const currentContext = `### CONTEXTO TEMPORAL\n- Hoje é ${dayName}, ${dateStr}\n- Hora atual: ${timeStr}`;

    return [
      'Você é um agente de engenharia de software ReAct de elite.',
      currentContext,
      'CONTRATO DE CICLO: Observe o contexto, PENSE em um JSON de ação curta, ATUE com ferramentas, VERIFIQUE o resultado.',
      '### REGRAS CRÍTICAS DE RESPOSTA:',
      '1. Sua resposta DEVE ser ÚNICA e EXCLUSIVAMENTE um objeto JSON válido.',
      '2. NÃO inclua saudações, explicações ou conversas fora do JSON.',
      '3. TODO o seu raciocínio deve estar dentro do campo "thought".',
      '4. Se você terminou a tarefa, use obrigatoriamente "complete_task".',
      '5. Se precisar de informações, use ferramentas de busca como "list_files" ou "search_text".',
      '',
      '### FORMATO JSON EXIGIDO:',
      '```json',
      '{',
      '  "thought": "Breve explicação do que você vai fazer agora",',
      '  "tool": "nome_da_ferramenta",',
      '  "arguments": { "arg1": "valor" }',
      '}',
      '```',
      '',
      this.config.registry.generateToolPrompt(),
      this.buildPersonaPrompt(),
      '\nIMPORTANTE: Responda SEMPRE em PORTUGUÊS (PT-BR). O campo "thought" deve estar em português.',
    ].join('\n\n');
  }

  private buildPersonaPrompt(): string {
    const style = this.config.personaStyle ?? 'standard';
    switch (style) {
      case 'concise':
        return '### PERSONA: CONCISE\n- Be extremely brief.\n- Minimize explanations.\n- Focus only on technical execution and results.';
      case 'explainer':
        return '### PERSONA: EXPLAINER\n- Provide high-level summaries of your actions.\n- Explain the "what" and the "how" in a way that non-technical stakeholders can understand.\n- Use analogies if helpful.';
      case 'tutor':
        return '### PERSONA: TUTOR\n- Explain the reasoning behind your decisions.\n- Point out best practices and potential pitfalls.\n- Encourage learning by explaining technical concepts used in the code.';
      case 'standard':
      default:
        return '### PERSONA: STANDARD\n- Be professional and helpful.\n- Provide clear thoughts and summaries of your work.';
    }
  }

  private isTerminal(status: AgentStatus): boolean {
    return status === 'completed' || status === 'error';
  }

  /** Check if budget is exceeded. Returns error message string if exceeded, null otherwise. */
  private checkBudget(): string | null {
    if (this.budgetUsed.calls >= this.budget.maxToolCalls) {
      return `Tool call budget exceeded: ${this.budgetUsed.calls}/${this.budget.maxToolCalls} calls used`;
    }
    if (this.budgetUsed.tokens >= this.budget.maxTokens) {
      return `Token budget exceeded: ${this.budgetUsed.tokens.toLocaleString()}/${this.budget.maxTokens.toLocaleString()} tokens used`;
    }
    if (this.budgetUsed.costUsd > this.budget.maxCostUsd) {
      return `Cost budget exceeded: ${this.budgetUsed.costUsd.toFixed(4)}/${this.budget.maxCostUsd.toFixed(2)}`;
    }
    return null;
  }
}

function extractSummary(data: JsonValue): string | undefined {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const summary = data.summary;
    if (typeof summary === 'string') {
      return summary;
    }
  }
  return undefined;
}

function extractCompletionStatus(data: JsonValue): 'success' | 'failure' | undefined {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const status = data.status;
    if (status === 'success' || status === 'failure') {
      return status;
    }
  }
  return undefined;
}

function extractCompletedFlag(data: JsonValue): boolean | undefined {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const completed = data.completed;
    if (typeof completed === 'boolean') {
      return completed;
    }
  }
  return undefined;
}

function extractErrorMessage(data: JsonValue): string | undefined {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const error = data.error;
    if (typeof error === 'string') {
      return error;
    }
  }
  return undefined;
}

function isSuspiciouslyEmpty(data: JsonValue): boolean {
  if (data === null) {
    return true;
  }

  if (Array.isArray(data)) {
    return data.length === 0;
  }

  if (typeof data === 'object') {
    return Object.keys(data).length === 0;
  }

  return false;
}
