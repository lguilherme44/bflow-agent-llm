import { Span } from '@opentelemetry/api';
import {
  AgentState,
  AgentStatus,
  JsonValue,
  LLMConfig,
  LLMResponse,
  ToolCall,
  ToolResult,
} from '../types';
import { ContextManager } from '../context/manager';
import { LLMAdapter, LLMResponseParser } from '../llm/adapter';
import { TracingService } from '../observability/tracing';
import { CheckpointManager } from '../state/checkpoint';
import { AgentStateMachine } from '../state/machine';
import { ExecutorConfig, ToolExecutor, ToolExecutorHooks } from '../tools/executor';
import { ToolRegistry } from '../tools/registry';

export interface ReActConfig {
  llm: LLMAdapter;
  registry: ToolRegistry;
  checkpointManager: CheckpointManager;
  contextManager: ContextManager;
  tracing?: TracingService;
  llmConfig?: Partial<LLMConfig>;
  executorConfig?: Partial<ExecutorConfig>;
  executorHooks?: ToolExecutorHooks;
  humanApprovalCallback?: (toolCall: ToolCall, reason: string) => Promise<boolean>;
  humanApprovalPolicy?: (toolCall: ToolCall, state: AgentState) => string | undefined;
}

export interface VerificationResult {
  terminal: boolean;
  state: AgentState;
}

export class ReActAgent {
  private readonly executor: ToolExecutor;

  constructor(private readonly config: ReActConfig) {
    this.executor = new ToolExecutor(
      config.registry,
      config.executorConfig,
      this.buildTracedHooks(config.executorHooks)
    );
  }

  /** Wrap user-provided hooks with tracing spans for tool calls. */
  private buildTracedHooks(userHooks?: ToolExecutorHooks): ToolExecutorHooks {
    const tracing = this.config.tracing;
    if (!tracing) return userHooks ?? {};

    const spanMap = new Map<string, Span>();

    return {
      ...userHooks,
      onToolStart: async (toolCall, attempt) => {
        if (attempt === 1) {
          const span = tracing.startToolSpan(toolCall.toolName, toolCall.id);
          spanMap.set(toolCall.id, span);
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
          tracing.recordToolResult(span, result);
          spanMap.delete(toolCall.id);
        }
        await userHooks?.onToolSuccess?.(toolCall, result);
      },
      onToolFailure: async (toolCall, result) => {
        const span = spanMap.get(toolCall.id);
        if (span) {
          tracing.recordToolResult(span, result);
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
    };
  }

  async run(task: string, existingState?: AgentState): Promise<AgentState> {
    let state = existingState ?? AgentStateMachine.create(task);
    const agentSpan = this.config.tracing?.startAgentSpan(task, state.id);
    await this.config.checkpointManager.checkpoint(state);

    try {
      while (!this.isTerminal(state.status)) {
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
          state = AgentStateMachine.complete(state, response.llmResponse.content);
          break;
        }

        state = await this.act(state, toolCalls);
        await this.config.checkpointManager.checkpoint(state);

        if (state.status === 'awaiting_human') {
          return state;
        }

        const verification = this.verify(state);
        state = verification.state;
        await this.config.checkpointManager.checkpoint(state);

        if (verification.terminal) {
          break;
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

  async resume(agentId: string): Promise<AgentState> {
    const state = await this.config.checkpointManager.resumeFromCheckpoint(agentId);
    if (!state) {
      throw new Error(`Checkpoint ${agentId} not found`);
    }

    if (!state.currentTask) {
      throw new Error('Restored state does not have a current task');
    }

    return this.run(state.currentTask, state);
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
      const rawResponse = await this.config.llm.complete(messages, this.config.llmConfig);
      llmResponse = this.normalizeLLMResponse(rawResponse);
      if (llmSpan) {
        this.config.tracing?.recordLLMUsage(llmSpan, llmResponse.usage);
      }
    } catch (error) {
      if (llmSpan) {
        this.config.tracing?.recordLLMError(llmSpan, error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }

    let next = AgentStateMachine.addTokenUsage(thinkingState, llmResponse.usage.totalTokens);
    next = AgentStateMachine.addMessage(next, {
      role: 'assistant',
      content: llmResponse.content,
      toolCalls: llmResponse.toolCalls,
      timestamp: new Date().toISOString(),
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
    if (AgentStateMachine.isStuck(state)) {
      return {
        terminal: true,
        state: AgentStateMachine.fail(state, 'Repeated identical tool calls detected'),
      };
    }

    const lastExecution = state.toolHistory.at(-1);
    if (!lastExecution) {
      return { terminal: false, state };
    }

    if (lastExecution.call.toolName === 'complete_task' && lastExecution.result.success) {
      const data = lastExecution.result.data;
      const summary = extractSummary(data) ?? 'Task completed through complete_task.';
      return {
        terminal: true,
        state: AgentStateMachine.complete(state, summary),
      };
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
    return [
      'You are a ReAct software engineering agent.',
      'Cycle contract: observe context, think with a short JSON action, act with tools, verify the result.',
      'Use complete_task when the task is done. If tool JSON is invalid, correct it on the next turn.',
      'Prefer AST-first code edits and request human approval for destructive, broad or sensitive actions.',
      this.config.registry.generateToolPrompt(),
    ].join('\n\n');
  }

  private isTerminal(status: AgentStatus): boolean {
    return status === 'completed' || status === 'error';
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
