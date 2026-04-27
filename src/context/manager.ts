import { randomUUID } from 'node:crypto';
import {
  AgentMessage,
  AgentState,
  ContextItem,
  ContextItemKind,
  JsonValue,
  RelevantFileContext,
  StructuredSummary,
} from '../types/index.js';
import { estimateTokensFromText } from '../utils/json.js';

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
      maxTokensEstimate: 5_000, // Reduzido para chamadas mais rápidas na GPU
      summarizeThreshold: 15,
      ...config,
    };
  }

  prepareMessages(state: AgentState, systemPrompt?: string): AgentMessage[] {
    const summary = this.buildStructuredSummary(state);
    let messages = this.ensureSystemAndTask([...state.messages], state, summary, systemPrompt);

    if (messages.length > this.config.maxMessages || this.estimateTokens(messages) > this.config.maxTokensEstimate) {
      messages = this.compactOldMessages(messages, summary);
    }

    messages = this.truncateMessages(messages);
    messages = this.prioritizeToolResults(messages);
    return messages;
  }

  private truncateMessages(messages: AgentMessage[]): AgentMessage[] {
    // Limite por mensagem reduzido para evitar prompts gigantes e lentos na GPU
    const perMessageLimit = 2500;
    
    return messages.map(msg => {
      const estimate = estimateTokensFromText(msg.content);
      if (estimate <= perMessageLimit) {
        return msg;
      }

      const allowedChars = perMessageLimit * 4;
      const truncatedContent = msg.content.slice(0, allowedChars) + 
        `... [Conteúdo truncado: ${estimate} tokens -> ${perMessageLimit} tokens para economizar contexto]`;
      
      return {
        ...msg,
        content: truncatedContent
      };
    });
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
    const latestUserMessages = messages.filter((message) => message.role === 'user').slice(-1);
    const recentCount = Math.max(0, this.config.maxMessages - 3);
    const recent = messages
      .filter((message) => message.role !== 'system' && message.role !== 'user')
      .slice(-recentCount);

    const summaryMessage: AgentMessage = {
      role: 'system',
      content: `Context Summary:\n- Task: ${summary.currentTask}\n- Files: ${summary.relevantFiles.slice(0, 5).join(', ')}\n- Last Progress: ${summary.progress.slice(-3).join(', ')}`,
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

      // Ideally we'd have the tool name in the message metadata.
      
      return {
        ...message,
        content: `[Omitido: Resultado da ferramenta (sucesso) para economizar contexto. Use a ferramenta novamente se precisar dos dados.]`,
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
      systemPrompt ?? 'You are a ReAct agent.',
      `Current task: ${state.currentTask ?? 'none'}`,
      summary.relevantFiles.length > 0 ? `Relevant files: ${summary.relevantFiles.slice(0, 3).join(', ')}` : '',
    ].filter(Boolean).join('\n');

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
    
    // Boost por razão (se houver palavras-chave da task)
    const reasonBoost = reason ? Math.min(reason.length / 5, 15) : 0;
    
    // Boost por acesso (leitura ou escrita)
    const accessBoost = read ? 8 : 15;
    
    // Penalidade por tempo (decrescimento suave)
    const decay = 0.95;
    
    // Centralidade: arquivos na raiz ou em pastas core ganham um pequeno boost passivo
    let centralityBoost = 0;
    if (previous?.filepath) {
      if (previous.filepath.includes('src/types') || previous.filepath.includes('src/index')) {
        centralityBoost = 5;
      }
    }

    return Math.min(100, (base * decay) + accessBoost + reasonBoost + centralityBoost);
  }
}
