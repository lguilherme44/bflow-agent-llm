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

/**
 * ContextManager with intelligent compression.
 *
 * Key strategies:
 * 1. Content-aware truncation — cuts at paragraph/sentence boundaries
 * 2. Progressive summarization — rich structured summaries
 * 3. Importance-based retention — keeps errors, decisions, approvals
 * 4. Deduplication — skips repeated tool results
 */
export class ContextManager {
  private readonly config: ContextConfig;

  constructor(config?: Partial<ContextConfig>) {
    this.config = {
      maxMessages: 50,
      maxTokensEstimate: 5_000,
      summarizeThreshold: 15,
      ...config,
    };
  }

  prepareMessages(state: AgentState, systemPrompt?: string): AgentMessage[] {
    const summary = this.buildStructuredSummary(state);
    let messages = this.ensureSystemAndTask([...state.messages], state, summary, systemPrompt);

    if (messages.length > this.config.maxMessages || this.estimateTokens(messages) > this.config.maxTokensEstimate) {
      messages = this.smartCompact(messages, summary);
    }

    messages = this.smartTruncate(messages);
    messages = this.deduplicateToolResults(messages);
    messages = this.prioritizeToolResults(messages);
    return messages;
  }

  // ── Smart Truncation (content-aware) ────────────────────────

  private smartTruncate(messages: AgentMessage[]): AgentMessage[] {
    const perMessageLimit = 2500;

    return messages.map(msg => {
      const estimate = estimateTokensFromText(msg.content);
      if (estimate <= perMessageLimit) return msg;

      // Truncate at paragraph boundary
      const allowedChars = perMessageLimit * 4;
      const truncated = this.truncateAtBoundary(msg.content, allowedChars);
      
      if (truncated.length >= msg.content.length - 50) return msg;

      return {
        ...msg,
        content: truncated + 
          `\n[... ${estimate - perMessageLimit} tokens omitidos para economizar contexto]`,
      };
    });
  }

  /** Truncate at the nearest sentence/paragraph boundary */
  private truncateAtBoundary(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;

    const slice = text.slice(0, maxChars);

    // Try to cut at paragraph break (double newline)
    const lastParaBreak = slice.lastIndexOf('\n\n');
    if (lastParaBreak > maxChars * 0.5) {
      return slice.slice(0, lastParaBreak).trimEnd();
    }

    // Try to cut at sentence end (. ! ? followed by space or newline)
    const sentenceEnds = [...slice.matchAll(/[.!?]\s+/g)];
    if (sentenceEnds.length > 0) {
      const lastSentence = sentenceEnds[sentenceEnds.length - 1];
      if (lastSentence.index !== undefined && lastSentence.index > maxChars * 0.4) {
        return slice.slice(0, lastSentence.index + 1).trimEnd();
      }
    }

    // Fallback: cut at last newline
    const lastNewline = slice.lastIndexOf('\n');
    if (lastNewline > maxChars * 0.5) {
      return slice.slice(0, lastNewline).trimEnd();
    }

    // Last resort: cut at last space
    const lastSpace = slice.lastIndexOf(' ');
    if (lastSpace > maxChars * 0.5) {
      return slice.slice(0, lastSpace).trimEnd();
    }

    return slice;
  }

  // ── Smart Compaction (replaces compactOldMessages) ───────────

  /**
   * Intelligent compaction: preserves critical information and generates
   * a rich structured summary that replaces most old messages.
   */
  private smartCompact(messages: AgentMessage[], summary: StructuredSummary): AgentMessage[] {
    const systemMsgs = messages.filter(m => m.role === 'system').slice(0, 1);
    const latestUser = messages.filter(m => m.role === 'user').slice(-1);

    // Score messages by importance
    const scored = messages
      .filter(m => m.role !== 'system' && m.role !== 'user')
      .map((m, i) => ({ msg: m, score: this.messageImportance(m, i, messages.length) }));

    // Keep top N by importance (not just recency)
    const topN = Math.min(this.config.maxMessages - 3, scored.length);
    const kept = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .sort((a, b) => messages.indexOf(a.msg) - messages.indexOf(b.msg)); // Restore chronological

    // Build rich summary message from discarded messages
    const discarded = scored.filter(s => !kept.includes(s));
    const compactSummary = this.buildCompactSummary(summary, discarded.map(d => d.msg));

    return [
      ...systemMsgs,
      compactSummary,
      ...latestUser,
      ...kept.map(s => s.msg),
    ];
  }

  /** Score a message by how important it is to keep */
  private messageImportance(msg: AgentMessage, index: number, total: number): number {
    let score = 0;

    // Recency boost
    score += (index / total) * 30;

    // Assistant messages with tool calls are important
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      score += 25;
    }

    // Tool results with errors are critical
    if (msg.role === 'tool' && msg.toolResult && !msg.toolResult.success) {
      score += 40;
    }

    // Tool results with high attempt count
    if (msg.role === 'tool' && msg.toolResult && msg.toolResult.attempts > 1) {
      score += 15;
    }

    // System/tool messages with decisions or constraints in content
    const content = msg.content.toLowerCase();
    if (content.includes('decision') || content.includes('approve') || content.includes('reject')) {
      score += 20;
    }

    // Short assistant messages (final responses) are important
    if (msg.role === 'assistant' && estimateTokensFromText(msg.content) < 200) {
      score += 10;
    }

    // Old, long, success-only tool results get low scores
    if (msg.role === 'tool' && msg.toolResult?.success && index < total * 0.3) {
      score -= 30;
    }

    return score;
  }

  /** Build a compact but informative summary from discarded messages */
  private buildCompactSummary(summary: StructuredSummary, discarded: AgentMessage[]): AgentMessage {
    const parts: string[] = [];

    // Task context
    if (summary.currentTask) {
      parts.push(`## Tarefa: ${summary.currentTask}`);
    }

    // Key decisions
    if (summary.decisions.length > 0) {
      parts.push('## Decisões tomadas:');
      for (const d of summary.decisions.slice(-6)) {
        parts.push(`- ${d}`);
      }
    }

    // Constraints
    if (summary.constraints.length > 0) {
      parts.push('## Restrições:');
      for (const c of summary.constraints.slice(-4)) {
        parts.push(`- ${c}`);
      }
    }

    // Progress
    if (summary.progress.length > 0) {
      parts.push('## Progresso recente:');
      for (const p of summary.progress.slice(-5)) {
        parts.push(`- ${p}`);
      }
    }

    // Errors
    if (summary.errorsAndAttempts.length > 0) {
      parts.push('## Erros encontrados:');
      for (const e of summary.errorsAndAttempts.slice(-5)) {
        parts.push(`- ${e}`);
      }
    }

    // Relevant files
    if (summary.relevantFiles.length > 0) {
      parts.push('## Arquivos relevantes:');
      for (const f of summary.relevantFiles.slice(0, 8)) {
        parts.push(`- \`${f}\``);
      }
    }

    // Next actions
    if (summary.nextActions.length > 0) {
      parts.push('## Próximas ações:');
      for (const a of summary.nextActions.slice(0, 3)) {
        parts.push(`- ${a}`);
      }
    }

    // Extract tool summaries from discarded tool messages
    const discardedTools = discarded.filter(m => m.role === 'tool' && m.toolResult?.success);
    if (discardedTools.length > 0 && estimateTokensFromText(parts.join('\n')) < 800) {
      const toolNames = [...new Set(discardedTools.map(m => {
        // Try to extract tool name from content
        const match = m.content.match(/Tool (\w+)|(\w+) result|result.*?(\w+)/i);
        return match?.[1] || match?.[2] || match?.[3] || 'unknown';
      }))];
      parts.push(`## Ferramentas executadas (resumo): ${toolNames.join(', ')}`);
    }

    parts.push(`\n[Contexto compactado: ${discarded.length} mensagens resumidas. As mensagens mantidas contêm os detalhes críticos.]`);

    return {
      role: 'system',
      content: parts.join('\n\n'),
      timestamp: new Date().toISOString(),
    };
  }

  // ── Deduplication ───────────────────────────────────────────

  /**
   * Remove consecutive duplicate tool results and repeated content.
   */
  private deduplicateToolResults(messages: AgentMessage[]): AgentMessage[] {
    const seen = new Set<string>();
    const result: AgentMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // For tool results, check if same content was already seen recently
      if (msg.role === 'tool' && msg.toolResult?.success) {
        const key = `${msg.toolResult.toolCallId}:${msg.content.slice(0, 100)}`;
        if (seen.has(key)) {
          // Replace with compact marker
          result.push({
            ...msg,
            content: `[Resultado duplicado omitido — mesmo conteúdo já presente no contexto]`,
          });
          continue;
        }
        seen.add(key);
      }

      result.push(msg);
    }

    return result;
  }

  // ── Original methods (enhanced) ─────────────────────────────

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

  // ── Preserved: prioritizeToolResults (enhanced) ─────────────

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

      // Compact successful old tool results with a one-liner
      const toolName = message.toolResult.toolCallId || 'unknown';
      const summary = message.content.slice(0, 120).replace(/\n/g, ' ');
      return {
        ...message,
        content: `[Omitido: ${toolName} — ${summary}...]`,
      };
    });
  }

  // ── Preserved helper methods ────────────────────────────────

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

    const reasonBoost = reason ? Math.min(reason.length / 5, 15) : 0;
    const accessBoost = read ? 8 : 15;
    const decay = 0.95;

    let centralityBoost = 0;
    if (previous?.filepath) {
      if (previous.filepath.includes('src/types') || previous.filepath.includes('src/index')) {
        centralityBoost = 5;
      }
    }

    return Math.min(100, (base * decay) + accessBoost + reasonBoost + centralityBoost);
  }
}
