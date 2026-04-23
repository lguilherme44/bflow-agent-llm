
import {
  AgentRole,
  AgentState,
  ExecutionStream,
  FailurePattern,
  FeedbackIteration,
  FeedbackLoopPolicy,
  StreamFailureKind,
} from '../types/index.js';

// ── Defaults ──────────────────────────────────────────────────

const DEFAULT_POLICY: FeedbackLoopPolicy = {
  maxRetries: 3,
  maxCostTokens: 500_000,
  enableAutoLintFix: true,
};

// ── Failure classification heuristics ─────────────────────────

const TEST_FAILURE_SIGNALS = [
  'test failed',
  'tests failed',
  'failing tests',
  'assertion error',
  'assertionerror',
  'expect(',
  'test validation failed',
  'test result: fail',
  '✗',
  '✘',
];

const BUILD_FAILURE_SIGNALS = [
  'build failed',
  'build validation failed',
  'compilation error',
  'tsc',
  'ts(',
  'error ts',
  'type error',
  'typeerror',
  'cannot find module',
  'cannot find name',
  'syntaxerror',
  'syntax error',
  'build error',
];

const LINT_FAILURE_SIGNALS = [
  'lint failed',
  'lint validation failed',
  'eslint',
  'prettier',
  'lint found issues',
  'lint error',
];

const REVIEW_REJECTION_SIGNALS = [
  'review',
  'reviewer',
  'rejected',
  'code quality',
  'vulnerability',
  'security issue',
  'não passou na revisão',
];

const REFINEMENT_SIGNALS = [
  'insufficient quality',
  'pode ser melhorado',
  'refinar',
  'refine',
  'melhorar legibilidade',
  'clean up',
];

// ── Role mapping per failure kind ─────────────────────────────

const FAILURE_TO_ROLE: Record<StreamFailureKind, AgentRole> = {
  test_failure: 'coder',       // Debug investigates, but coder fixes — we use 'coder' with debug context
  build_failure: 'coder',
  lint_failure: 'coder',
  review_rejection: 'coder',
  insufficient_quality: 'coder',
  unknown: 'coder',
};

// In practice, test failures route to debug prompt for investigation
const FAILURE_TO_PROMPT_ROLE: Record<StreamFailureKind, string> = {
  test_failure: 'debug',
  build_failure: 'coder',
  lint_failure: 'coder',
  review_rejection: 'coder',
  insufficient_quality: 'coder',
  unknown: 'coder',
};

// ── Engine ────────────────────────────────────────────────────

export class FeedbackLoopEngine {
  private readonly policy: FeedbackLoopPolicy;
  private readonly iterations = new Map<string, FeedbackIteration[]>();
  private readonly patterns = new Map<string, FailurePattern>();

  constructor(policy?: Partial<FeedbackLoopPolicy>) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  // ── Classify ──────────────────────────────────────────────

  /**
   * Inspect the failed worker state and stream metadata to determine
   * what kind of failure occurred.
   * 
   * Classification priority: build > lint > review > test > unknown.
   * More specific signals are checked before general ones to avoid
   * false positives (e.g. "Build validation failed" matching test signals).
   */
  classifyFailure(workerState: AgentState, _stream: ExecutionStream): StreamFailureKind {
    const errorText = this.extractErrorText(workerState).toLowerCase();
    return classifyText(errorText);
  }

  /**
   * Classify from an error string when worker state is not available.
   */
  classifyFromError(error: string): StreamFailureKind {
    return classifyText(error.toLowerCase());
  }

  // ── Retry decision ────────────────────────────────────────

  /**
   * Determine whether another feedback loop iteration is allowed.
   */
  shouldRetry(streamId: string, totalTokensUsed: number): boolean {
    const history = this.iterations.get(streamId) ?? [];

    if (history.length >= this.policy.maxRetries) {
      return false;
    }

    if (totalTokensUsed >= this.policy.maxCostTokens) {
      return false;
    }

    return true;
  }

  // ── Recovery stream creation ──────────────────────────────

  /**
   * Create a new ExecutionStream whose tasks focus on fixing the
   * specific failure kind from the original stream.
   */
  createRecoveryStream(
    originalStream: ExecutionStream,
    failureKind: StreamFailureKind,
    error: string
  ): ExecutionStream {
    const iteration = (this.iterations.get(originalStream.id) ?? []).length + 1;
    const recoveryId = `${originalStream.id}-recovery-${iteration}`;
    const owner = FAILURE_TO_ROLE[failureKind];

    const recoveryTasks = this.buildRecoveryTasks(failureKind, error, originalStream);

    return {
      id: recoveryId,
      name: `Recovery (${failureKind}) for ${originalStream.name} #${iteration}`,
      owner,
      tasks: recoveryTasks,
      validations: originalStream.validations,
      status: 'pending',
      blockedBy: [],
      // Attach the prompt role as metadata for the orchestrator to use
    } satisfies ExecutionStream & { _promptRole?: string };
  }

  /**
   * Get the prompt role to use for a given failure kind.
   * This may differ from the stream owner (e.g. debug for test failures).
   */
  getPromptRoleForFailure(failureKind: StreamFailureKind): string {
    return FAILURE_TO_PROMPT_ROLE[failureKind];
  }

  // ── Iteration tracking ────────────────────────────────────

  recordIteration(iteration: FeedbackIteration): void {
    const history = this.iterations.get(iteration.streamId) ?? [];
    history.push(iteration);
    this.iterations.set(iteration.streamId, history);

    // Record pattern
    this.recordPattern(iteration);
  }

  getIterations(streamId: string): FeedbackIteration[] {
    return this.iterations.get(streamId) ?? [];
  }

  getIterationCount(streamId: string): number {
    return (this.iterations.get(streamId) ?? []).length;
  }

  // ── Failure patterns ──────────────────────────────────────

  getFailurePatterns(): FailurePattern[] {
    return Array.from(this.patterns.values());
  }

  // ── Policy access ─────────────────────────────────────────

  getPolicy(): Readonly<FeedbackLoopPolicy> {
    return this.policy;
  }

  // ── Private helpers ───────────────────────────────────────

  private extractErrorText(state: AgentState): string {
    const parts: string[] = [];

    // Error from metadata
    if (state.metadata.errorMessage) {
      parts.push(state.metadata.errorMessage);
    }

    // Last few tool results that failed
    const recentFailures = state.toolHistory
      .filter(entry => !entry.result.success)
      .slice(-3);

    for (const entry of recentFailures) {
      if (entry.result.error) {
        parts.push(entry.result.error);
      }
      if (entry.result.data && typeof entry.result.data === 'string') {
        parts.push(entry.result.data);
      }
    }

    // Last system/tool messages
    const recentMessages = state.messages
      .filter(m => m.role === 'system' || m.role === 'tool')
      .slice(-5);

    for (const msg of recentMessages) {
      parts.push(msg.content);
    }

    return parts.join('\n');
  }

  private buildRecoveryTasks(
    kind: StreamFailureKind,
    error: string,
    original: ExecutionStream
  ): string[] {
    const context = `Erro original: ${error.slice(0, 500)}`;
    const originalTasks = `Tarefas originais: ${original.tasks.join(', ')}`;

    switch (kind) {
      case 'test_failure':
        return [
          `FEEDBACK LOOP - Testes falharam no stream "${original.name}".`,
          context,
          originalTasks,
          'Investigar a causa raiz da falha de testes.',
          'Analisar o stack trace e os arquivos envolvidos.',
          'Propor e aplicar a correção mínima necessária.',
          'Rodar os testes novamente para verificar a correção.',
        ];

      case 'build_failure':
        return [
          `FEEDBACK LOOP - Build falhou no stream "${original.name}".`,
          context,
          originalTasks,
          'Identificar os erros de compilação TypeScript.',
          'Corrigir os erros de tipo, imports ou sintaxe.',
          'Rodar o build novamente para verificar a correção.',
        ];

      case 'lint_failure':
        return [
          `FEEDBACK LOOP - Lint falhou no stream "${original.name}".`,
          context,
          originalTasks,
          this.policy.enableAutoLintFix
            ? 'Tentar rodar o linter com --fix para corrigir automaticamente.'
            : 'Corrigir os problemas de lint manualmente.',
          'Verificar o resultado do lint após a correção.',
        ];

      case 'review_rejection':
        return [
          `FEEDBACK LOOP - Revisão rejeitou o código do stream "${original.name}".`,
          context,
          originalTasks,
          'Analisar os comentários da revisão.',
          'Aplicar as correções sugeridas pelo reviewer.',
          'Verificar que o código corrigido atende aos padrões.',
        ];

      case 'insufficient_quality':
        return [
          `FEEDBACK LOOP - Qualidade insuficiente detectada no stream "${original.name}".`,
          context,
          'Identificar áreas do código que podem ser simplificadas ou melhoradas.',
          'Aplicar refatorações para melhorar a legibilidade e manutenibilidade.',
          'Garantir que as melhorias não alterem o comportamento funcional (se possível, rodar testes).',
        ];

      case 'unknown':
      default:
        return [
          `FEEDBACK LOOP - Falha desconhecida no stream "${original.name}".`,
          context,
          originalTasks,
          'Investigar a causa raiz do erro.',
          'Propor e aplicar a correção mínima necessária.',
        ];
    }
  }

  private recordPattern(iteration: FeedbackIteration): void {
    const signature = this.normalizeErrorSignature(iteration.error);
    const key = `${iteration.failureKind}:${signature}`;
    const now = new Date().toISOString();

    const existing = this.patterns.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = now;
      existing.total += 1;
      if (iteration.resolved) {
        existing.resolved += 1;
      }
    } else {
      this.patterns.set(key, {
        kind: iteration.failureKind,
        errorSignature: signature,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        resolved: iteration.resolved ? 1 : 0,
        total: 1,
      });
    }
  }

  private normalizeErrorSignature(error: string): string {
    // Extract the first meaningful line and strip variable data (paths, line numbers)
    const firstLine = error.split('\n')[0] ?? error;
    return firstLine
      .replace(/\b[A-Z]:[\\\/][^\s]+/gi, '<PATH>') // Windows paths
      .replace(/\/[^\s:]+/g, '<PATH>')              // Unix paths
      .replace(/:\d+:\d+/g, ':<L>:<C>')            // Line:Column
      .replace(/\b\d+\b/g, '<N>')                   // Numbers
      .slice(0, 200)
      .trim();
  }
}

function matchesAny(text: string, signals: string[]): boolean {
  return signals.some(signal => text.includes(signal));
}

/**
 * Classify error text with priority ordering.
 * Build/Lint/Review are checked BEFORE test signals because test signals
 * are broader and can match build/lint error strings (e.g. "Build validation failed"
 * contains "failed" which would match test signals if checked first).
 */
function classifyText(text: string): StreamFailureKind {
  if (matchesAny(text, BUILD_FAILURE_SIGNALS)) return 'build_failure';
  if (matchesAny(text, LINT_FAILURE_SIGNALS)) return 'lint_failure';
  if (matchesAny(text, REVIEW_REJECTION_SIGNALS)) return 'review_rejection';
  if (matchesAny(text, REFINEMENT_SIGNALS)) return 'insufficient_quality';
  if (matchesAny(text, TEST_FAILURE_SIGNALS)) return 'test_failure';

  return 'unknown';
}

