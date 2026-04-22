import { randomUUID } from 'node:crypto';
import {
  AgentMessage,
  AgentState,
  ContextItem,
  ContextItemKind,
  JsonValue,
  RelevantFileContext,
  StructuredSummary,
} from '../types';
import { estimateTokensFromText } from '../utils/json';

export interface ContextConfig {
  maxMessages: number;
  maxTokensEstimate: number;
  summarizeThreshold: number;
}

export class ContextManager {
  private readonly config: ContextConfig;

  constructor(config?: Partial<ContextConfig>) {
    this.config = {
      maxMessages: 50,
      maxTokensEstimate: 8_000,
      summarizeThreshold: 30,
      ...config,
    };
  }

  prepareMessages(state: AgentState, systemPrompt?: string): AgentMessage[] {
    const summary = this.buildStructuredSummary(state);
    let messages = this.ensureSystemAndTask([...state.messages], state, summary, systemPrompt);

    if (messages.length > this.config.maxMessages || this.estimateTokens(messages) > this.config.maxTokensEstimate) {
      messages = this.compactOldMessages(messages, summary);
    }

    messages = this.prioritizeToolResults(messages);
    return messages;
  }

  addFileContext(state: AgentState, filepath: string, content: string, reason?: string): AgentState {
    const now = new Date().toISOString();
    const previous = state.context.relevantFiles[filepath];
    const relevantFile: RelevantFileContext = {
      filepath,
      readCount: (previous?.readCount ?? 0) + 1,
      touchCount: previous?.touchCount ?? 0,
      lastReadAt: now,
      lastTouchedAt: previous?.lastTouchedAt,
      score: this.scoreFile(previous, reason, true),
      reason,
    };

    return this.withContextItem(
      {
        ...state,
        context: {
          ...state.context,
          relevantFiles: {
            ...state.context.relevantFiles,
            [filepath]: relevantFile,
          },
        },
      },
      'file',
      content,
      80,
      { filepath, reason: reason ?? null }
    );
  }

  markFileTouched(state: AgentState, filepath: string, reason?: string): AgentState {
    const now = new Date().toISOString();
    const previous = state.context.relevantFiles[filepath];
    const relevantFile: RelevantFileContext = {
      filepath,
      readCount: previous?.readCount ?? 0,
      touchCount: (previous?.touchCount ?? 0) + 1,
      lastReadAt: previous?.lastReadAt,
      lastTouchedAt: now,
      score: this.scoreFile(previous, reason, false),
      reason,
    };

    return {
      ...state,
      context: {
        ...state.context,
        relevantFiles: {
          ...state.context.relevantFiles,
          [filepath]: relevantFile,
        },
      },
    };
  }

  markDecision(state: AgentState, decision: string): AgentState {
    return this.withContextItem(
      {
        ...state,
        context: {
          ...state.context,
          decisions: [...state.context.decisions, decision],
        },
      },
      'decision',
      decision,
      95,
      {}
    );
  }

  markConstraint(state: AgentState, constraint: string): AgentState {
    return this.withContextItem(
      {
        ...state,
        context: {
          ...state.context,
          constraints: [...state.context.constraints, constraint],
        },
      },
      'constraint',
      constraint,
      100,
      {}
    );
  }

  estimateTokens(messages: AgentMessage[]): number {
    return messages.reduce((total, message) => total + estimateTokensFromText(message.content), 0);
  }

  buildStructuredSummary(state: AgentState): StructuredSummary {
    const relevantFiles = Object.values(state.context.relevantFiles)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((file) => file.filepath);

    const errorsAndAttempts = state.toolHistory
      .filter((entry) => !entry.result.success)
      .slice(-8)
      .map((entry) => `${entry.call.toolName}: ${entry.result.error ?? 'failed'}`);

    const humanApprovals = state.eventHistory
      .filter((event) => event.type === 'human_approval_requested' || event.type === 'human_approval_resolved')
      .slice(-8)
      .map((event) => `${event.type}${event.reason ? `: ${event.reason}` : ''}`);

    const progress = state.toolHistory
      .filter((entry) => entry.result.success)
      .slice(-8)
      .map((entry) => `${entry.call.toolName} succeeded`);

    return {
      currentTask: state.currentTask,
      progress,
      decisions: state.context.decisions.slice(-12),
      constraints: state.context.constraints.slice(-12),
      relevantFiles,
      errorsAndAttempts,
      humanApprovals,
      nextActions: this.inferNextActions(state),
    };
  }

  private withContextItem(
    state: AgentState,
    kind: ContextItemKind,
    content: string,
    priority: number,
    metadata: Record<string, JsonValue>
  ): AgentState {
    const now = new Date().toISOString();
    const item: ContextItem = {
      id: randomUUID(),
      kind,
      content,
      createdAt: now,
      updatedAt: now,
      tokensEstimate: estimateTokensFromText(content),
      priority,
      metadata,
    };

    return {
      ...state,
      context: {
        ...state.context,
        items: [...state.context.items, item],
      },
    };
  }

  private compactOldMessages(messages: AgentMessage[], summary: StructuredSummary): AgentMessage[] {
    const systemMessages = messages.filter((message) => message.role === 'system').slice(0, 1);
    const latestUserMessages = messages.filter((message) => message.role === 'user').slice(-2);
    const recent = messages
      .filter((message) => message.role !== 'system' && message.role !== 'user')
      .slice(-this.config.summarizeThreshold);

    const summaryMessage: AgentMessage = {
      role: 'system',
      content: `Structured context summary:\n${JSON.stringify(summary, null, 2)}`,
      timestamp: new Date().toISOString(),
    };

    return [...systemMessages, summaryMessage, ...latestUserMessages, ...recent];
  }

  private prioritizeToolResults(messages: AgentMessage[]): AgentMessage[] {
    return messages.map((message, index) => {
      if (message.role !== 'tool' || !message.toolResult) {
        return message;
      }

      const isRecent = index >= messages.length - 10;
      const isError = !message.toolResult.success;
      if (isRecent || isError) {
        return message;
      }

      return {
        ...message,
        content: '[Earlier successful tool result compacted. Full result remains in toolHistory checkpoint.]',
      };
    });
  }

  private ensureSystemAndTask(
    messages: AgentMessage[],
    state: AgentState,
    summary: StructuredSummary,
    systemPrompt?: string
  ): AgentMessage[] {
    const basePrompt = [
      systemPrompt ?? 'You are a checkpointable ReAct software engineering agent.',
      'Preserve task goals, decisions, constraints, errors, touched files and human approvals.',
      `Current task: ${state.currentTask ?? 'none'}`,
      `Context summary: ${JSON.stringify(summary)}`,
    ].join('\n');

    const nonSystem = messages.filter((message) => message.role !== 'system');
    return [
      {
        role: 'system',
        content: basePrompt,
        timestamp: new Date().toISOString(),
      },
      ...nonSystem,
    ];
  }

  private inferNextActions(state: AgentState): string[] {
    if (state.pendingHumanApproval && !state.pendingHumanApproval.resolved) {
      return [`Await human approval for ${state.pendingHumanApproval.toolCall.toolName}`];
    }

    if (state.status === 'error') {
      return ['Inspect the latest error and choose a recoverable correction'];
    }

    if (state.toolHistory.length === 0) {
      return ['Observe project context and choose the first safe tool call'];
    }

    return ['Continue the observe-think-act-verify loop'];
  }

  private scoreFile(previous: RelevantFileContext | undefined, reason: string | undefined, read: boolean): number {
    const base = previous?.score ?? 0;
    const reasonBoost = reason ? Math.min(reason.length / 10, 10) : 0;
    const accessBoost = read ? 6 : 10;
    return Math.min(100, base * 0.9 + accessBoost + reasonBoost);
  }
}
