/**
 * Ralph Loop — autonomous iteration engine.
 *
 * Inspired by Claude Code's "ralph-wiggum" plugin.
 * Repeats a task up to N times until it passes all validation gates.
 * Between iterations, it feeds the previous error/output as context.
 */
import { AgentState } from '../types/index.js';
import type { OrchestratorAgent } from '../agent/orchestrator.js';

export interface RalphLoopConfig {
  /** Maximum iterations (default: 5) */
  maxIterations: number;
  /** Delay between iterations in ms (default: 1000) */
  delayMs: number;
  /** Stop on first error or keep trying? (default: false = keep trying) */
  stopOnError: boolean;
  /** Callback for progress updates */
  onProgress?: (event: { iteration: number; status: string; error?: string }) => void;
}

export interface RalphLoopResult {
  success: boolean;
  iterations: number;
  finalState: AgentState;
  errors: string[];
}

/**
 * Run a task autonomously until it succeeds or max iterations are reached.
 */
export async function ralphLoop(
  orchestrator: OrchestratorAgent,
  task: string,
  config: Partial<RalphLoopConfig> = {}
): Promise<RalphLoopResult> {
  const cfg: RalphLoopConfig = {
    maxIterations: config.maxIterations ?? 5,
    delayMs: config.delayMs ?? 1000,
    stopOnError: config.stopOnError ?? false,
    onProgress: config.onProgress,
  };

  const errors: string[] = [];
  let finalState: AgentState | null = null;

  for (let i = 1; i <= cfg.maxIterations; i++) {
    cfg.onProgress?.({ iteration: i, status: 'running' });

    try {
      // Build enriched task with previous errors
      let enrichedTask = task;
      if (errors.length > 0) {
        enrichedTask = `${task}\n\n[Iteração ${i}/${cfg.maxIterations}]\nErros anteriores:\n${errors.map((e, j) => `  ${j + 1}. ${e}`).join('\n')}\n\nCorrija os erros acima e complete a tarefa.`;
      }

      const result = await orchestrator.run(enrichedTask);
      finalState = result.state;

      if (result.state.status === 'completed') {
        cfg.onProgress?.({ iteration: i, status: 'completed' });
        return { success: true, iterations: i, finalState: result.state, errors };
      }

      const errorMsg = result.state.metadata.errorMessage || 'Unknown error';
      errors.push(`[Iteration ${i}] ${errorMsg}`);
      cfg.onProgress?.({ iteration: i, status: 'failed', error: errorMsg });

      if (cfg.stopOnError) {
        return { success: false, iterations: i, finalState: result.state, errors };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`[Iteration ${i}] ${errorMsg}`);
      cfg.onProgress?.({ iteration: i, status: 'error', error: errorMsg });

      if (cfg.stopOnError) {
        return { success: false, iterations: i, finalState: finalState!, errors };
      }
    }

    // Wait between iterations
    if (i < cfg.maxIterations) {
      await new Promise(resolve => setTimeout(resolve, cfg.delayMs));
    }
  }

  return {
    success: false,
    iterations: cfg.maxIterations,
    finalState: finalState!,
    errors,
  };
}

/** CLI command wrapper for Ralph Loop */
export function ralphCommandHelp(): string {
  return [
    '/ralph <task> [--max=N] [--delay=MS] [--stop-on-error]',
    '  Executa uma tarefa repetidamente até passar.',
    '  --max=N        Máximo de iterações (default: 5)',
    '  --delay=MS     Delay entre iterações em ms (default: 1000)',
    '  --stop-on-error Para na primeira falha',
    '  Ex: /ralph "Corrigir todos os erros de typecheck" --max=3',
  ].join('\n');
}
