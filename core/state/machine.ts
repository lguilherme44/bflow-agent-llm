import { randomUUID } from 'node:crypto';
import {
  AgentEvent,
  AgentEventType,
  AgentMessage,
  AgentState,
  AgentStatus,
  HumanApprovalRequest,
  ToolCall,
  ToolResult,
} from '../types/index.js';

type TransitionResolver = (state: AgentState, event: AgentEvent) => AgentStatus;

export class AgentStateMachine {
  static readonly CURRENT_SCHEMA_VERSION = 1;

  private static readonly EVENT_TRANSITIONS: Record<
    AgentStatus,
    Partial<Record<AgentEventType, AgentStatus | TransitionResolver>>
  > = {
    idle: {
      task_started: 'observing',
      observation_started: 'observing',
      task_failed: 'error',
      reset_requested: 'idle',
    },
    observing: {
      thought_started: 'thinking',
      task_completed: 'completed',
      task_failed: 'error',
      reset_requested: 'idle',
    },
    thinking: {
      tool_call_started: 'acting',
      human_approval_requested: 'awaiting_human',
      verification_started: 'observing',
      task_completed: 'completed',
      task_failed: 'error',
      resume_requested: 'observing',
    },
    acting: {
      tool_call_finished: 'observing',
      human_approval_requested: 'awaiting_human',
      verification_started: 'observing',
      task_failed: 'error',
      resume_requested: 'observing',
    },
    awaiting_human: {
      human_approval_resolved: (_state, event) => (event.approved ? 'acting' : 'observing'),
      resume_requested: 'awaiting_human',
      task_failed: 'error',
      reset_requested: 'idle',
    },
    error: {
      reset_requested: 'idle',
      resume_requested: 'observing',
    },
    completed: {
      reset_requested: 'idle',
    },
  };

  static create(task: string, maxIterations = 100): AgentState {
    const now = new Date().toISOString();
    const userMessage: AgentMessage = {
      role: 'user',
      content: task,
      timestamp: now,
    };

    return {
      id: randomUUID(),
      status: 'idle',
      messages: [userMessage],
      currentTask: task,
      toolHistory: [],
      eventHistory: [],
      context: {
        items: [],
        decisions: [],
        constraints: [],
        relevantFiles: {},
      },
      metadata: {
        createdAt: now,
        updatedAt: now,
        iterationCount: 0,
        maxIterations,
        totalTokensUsed: 0,
        checkpointVersion: 1,
        schemaVersion: this.CURRENT_SCHEMA_VERSION,
      },
    };
  }

  static dispatch(
    state: AgentState,
    eventInput: Omit<AgentEvent, 'timestamp' | 'from' | 'to'> & { timestamp?: string }
  ): AgentState {
    const timestamp = eventInput.timestamp ?? new Date().toISOString();
    const transition = this.EVENT_TRANSITIONS[state.status][eventInput.type];

    if (!transition) {
      const valid = Object.keys(this.EVENT_TRANSITIONS[state.status]).join(', ');
      throw new Error(`Invalid event "${eventInput.type}" from "${state.status}". Valid events: ${valid}`);
    }

    const baseEvent: AgentEvent = {
      ...eventInput,
      timestamp,
      from: state.status,
      to: state.status,
    };
    const nextStatus = typeof transition === 'function' ? transition(state, baseEvent) : transition;
    const event: AgentEvent = { ...baseEvent, to: nextStatus };

    return this.updateState(state, {
      status: nextStatus,
      eventHistory: [...state.eventHistory, event],
    });
  }

  static addMessage(state: AgentState, message: AgentMessage): AgentState {
    return this.updateState(state, {
      messages: [...state.messages, message],
    });
  }

  static addToolExecution(state: AgentState, call: ToolCall, result: ToolResult): AgentState {
    return this.updateState(state, {
      toolHistory: [...state.toolHistory, { call, result }],
    });
  }

  static incrementIteration(state: AgentState): AgentState {
    const newCount = state.metadata.iterationCount + 1;
    if (newCount > state.metadata.maxIterations) {
      return this.fail(state, `Iteration limit reached: ${state.metadata.maxIterations}`);
    }

    return this.updateState(state, {
      metadata: {
        ...state.metadata,
        iterationCount: newCount,
      },
    });
  }

  static addTokenUsage(state: AgentState, tokens: number): AgentState {
    return this.updateState(state, {
      metadata: {
        ...state.metadata,
        totalTokensUsed: state.metadata.totalTokensUsed + tokens,
      },
    });
  }

  static requestHumanApproval(
    state: AgentState,
    toolCall: ToolCall,
    reason: string,
    policyName?: string
  ): AgentState {
    const requestedAt = new Date().toISOString();
    const approval: HumanApprovalRequest = {
      id: randomUUID(),
      toolCall,
      reason,
      policyName,
      requestedAt,
      resolved: false,
    };

    const next = this.dispatch(state, {
      type: 'human_approval_requested',
      toolCallId: toolCall.id,
      reason,
      timestamp: requestedAt,
    });

    return this.updateState(next, { pendingHumanApproval: approval });
  }

  static resolveHumanApproval(
    state: AgentState,
    approved: boolean,
    resolutionMessage?: string
  ): AgentState {
    if (!state.pendingHumanApproval) {
      throw new Error('There is no pending human approval');
    }

    const resolvedAt = new Date().toISOString();
    const pendingHumanApproval: HumanApprovalRequest = {
      ...state.pendingHumanApproval,
      resolved: true,
      approved,
      resolvedAt,
      resolutionMessage,
    };

    const next = this.updateState(state, { pendingHumanApproval });
    return this.dispatch(next, {
      type: 'human_approval_resolved',
      approved,
      toolCallId: pendingHumanApproval.toolCall.id,
      reason: resolutionMessage,
      timestamp: resolvedAt,
    });
  }

  static complete(state: AgentState, summary: string): AgentState {
    const withMessage = this.addMessage(state, {
      role: 'system',
      content: `Task completed: ${summary}`,
      timestamp: new Date().toISOString(),
    });
    const completed = this.EVENT_TRANSITIONS[withMessage.status].task_completed
      ? this.dispatch(withMessage, { type: 'task_completed', reason: summary })
      : withMessage;
    return this.updateState(completed, {
      metadata: {
        ...withMessage.metadata,
        completedAt: new Date().toISOString(),
      },
    });
  }

  static fail(state: AgentState, errorMessage: string): AgentState {
    const failed = this.EVENT_TRANSITIONS[state.status].task_failed
      ? this.dispatch(state, {
          type: 'task_failed',
          reason: errorMessage,
        })
      : state;

    return this.updateState(failed, {
      metadata: {
        ...failed.metadata,
        errorMessage,
      },
    });
  }

  static recoverForResume(state: AgentState, reason: string): AgentState {
    const now = new Date().toISOString();
    const next = this.EVENT_TRANSITIONS[state.status].resume_requested
      ? this.dispatch(state, {
          type: 'resume_requested',
          reason,
          timestamp: now,
        })
      : state;

    return this.addMessage(
      this.updateState(next, {
        metadata: {
          ...next.metadata,
          lastResumeReason: reason,
        },
      }),
      {
        role: 'system',
        content: `Resumed from checkpoint: ${reason}`,
        timestamp: now,
      }
    );
  }

  static validateSerializable(state: AgentState): void {
    try {
      JSON.parse(JSON.stringify(state));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`AgentState must be JSON serializable: ${message}`);
    }
  }

  static isStuck(state: AgentState, windowSize = 10): boolean {
    const recent = state.toolHistory.slice(-windowSize);
    if (recent.length < 4) {
      return false;
    }

    const calls = recent.map((entry) => `${entry.call.toolName}:${JSON.stringify(entry.call.arguments)}`);
    
    // Contagem de frequencia de chamadas identicas
    const counts: Record<string, number> = {};
    for (const call of calls) {
      counts[call] = (counts[call] ?? 0) + 1;
      if (counts[call] >= 3) {
        // Se a mesma ferramenta com mesmos argumentos foi chamada 3 vezes nas ultimas 10 acoes,
        // consideramos que o agente esta em loop (ping-pong ou consecutivo).
        
        // Excecao: chamadas que falharam podem ser repetidas para tentativa de recuperacao
        // ate o limite do detectFailureLoop. Aqui focamos em sucesso repetido sem progresso.
        const callEntries = recent.filter(e => `${e.call.toolName}:${JSON.stringify(e.call.arguments)}` === call);
        if (callEntries.some(e => e.result.success)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Detects when the agent is in a failure loop — repeating the same
   * failing tool call without making progress. Returns the repeated
   * error message if detected, or null otherwise.
   */
  static detectFailureLoop(state: AgentState, windowSize = 3): string | null {
    const recent = state.toolHistory.slice(-windowSize);
    if (recent.length < windowSize) {
      return null;
    }

    const allFailed = recent.every((entry) => !entry.result.success);
    if (!allFailed) {
      return null;
    }

    const calls = recent.map((entry) => `${entry.call.toolName}:${JSON.stringify(entry.call.arguments)}`);
    if (new Set(calls).size === 1) {
      const lastError = recent.at(-1)?.result.error ?? 'Unknown error';
      return `Tool "${recent[0].call.toolName}" has failed ${windowSize} times consecutively with the same arguments. Last error: ${lastError}`;
    }

    return null;
  }

  private static updateState(state: AgentState, partial: Partial<AgentState>): AgentState {
    const next: AgentState = {
      ...state,
      ...partial,
      metadata: {
        ...state.metadata,
        ...(partial.metadata ?? {}),
        updatedAt: new Date().toISOString(),
        checkpointVersion: state.metadata.checkpointVersion + 1,
      },
    };

    this.validateSerializable(next);
    return next;
  }
}
