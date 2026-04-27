/**
 * Eval Harness — pipeline de avaliação contínua do agente.
 *
 * Executa um conjunto de tasks conhecidas e mede:
 * - Taxa de sucesso
 * - Custo médio (tokens e USD)
 * - Tempo de execução
 * - Correções humanas necessárias
 *
 * Uso: npx tsx src/eval/run.ts [--suite smoke|full]
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

export interface EvalCase {
  name: string;
  task: string;
  expectSuccess: boolean;
  /** Palavras-chave que devem aparecer na resposta final */
  expectedKeywords?: string[];
  /** Arquivos que devem ser criados/modificados */
  expectedFiles?: string[];
}

export interface EvalResult {
  case: string;
  success: boolean;
  passed: boolean;
  tokensUsed: number;
  estimatedCostUsd: number;
  durationMs: number;
  toolCalls: number;
  errors: string[];
  humanApprovalsNeeded: number;
  responsePreview: string;
}

export interface EvalSummary {
  suite: string;
  timestamp: string;
  totalCases: number;
  passedCases: number;
  passRate: number;
  avgTokens: number;
  avgCostUsd: number;
  avgDurationMs: number;
  results: EvalResult[];
}

// ── Benchmark Suites ──────────────────────────────────────────

export const SMOKE_SUITE: EvalCase[] = [
  {
    name: 'simple read',
    task: 'Liste os arquivos no diretório src/agent/ e me diga quantos existem.',
    expectSuccess: true,
    expectedKeywords: ['react-loop', 'orchestrator', 'research', 'planning'],
  },
  {
    name: 'code search',
    task: 'Encontre onde a função "buildStructuredSummary" está definida e me diga o arquivo.',
    expectSuccess: true,
    expectedKeywords: ['context', 'manager'],
  },
  {
    name: 'error handling',
    task: 'Execute um comando inválido "nonexistent_command_xyz" e me diga o que aconteceu.',
    expectSuccess: true,
    expectedKeywords: ['erro', 'não encontrado', 'error'],
  },
  {
    name: 'greeting',
    task: 'Oi! Como vai?',
    expectSuccess: true,
  },
];

export const FULL_SUITE: EvalCase[] = [
  ...SMOKE_SUITE,
  {
    name: 'create and delete file',
    task: 'Crie um arquivo /tmp/agent-eval-test.txt com o conteúdo "hello eval" e depois me diga que foi criado.',
    expectSuccess: true,
    expectedKeywords: ['criado', 'created', 'eval'],
  },
  {
    name: 'multi-step investigation',
    task: 'Investigue como o sistema de checkpoint funciona. Quais arquivos estão envolvidos?',
    expectSuccess: true,
    expectedKeywords: ['checkpoint', 'state', 'machine'],
    expectedFiles: ['src/state/checkpoint.ts', 'src/state/machine.ts'],
  },
  {
    name: 'RAG retrieval',
    task: 'Use retrieve_context para buscar informações sobre o "RiskPolicyEngine". Quais arquivos ele encontra?',
    expectSuccess: true,
    expectedKeywords: ['risk', 'engine'],
  },
];

// ── Eval Runner ───────────────────────────────────────────────

export class EvalRunner {
  private results: EvalResult[] = [];

  addResult(result: EvalResult): void {
    this.results.push(result);
  }

  summarize(suiteName: string): EvalSummary {
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    
    const totalTokens = this.results.reduce((s, r) => s + r.tokensUsed, 0);
    const totalCost = this.results.reduce((s, r) => s + r.estimatedCostUsd, 0);
    const totalDuration = this.results.reduce((s, r) => s + r.durationMs, 0);

    return {
      suite: suiteName,
      timestamp: new Date().toISOString(),
      totalCases: total,
      passedCases: passed,
      passRate: total > 0 ? (passed / total) * 100 : 0,
      avgTokens: total > 0 ? Math.round(totalTokens / total) : 0,
      avgCostUsd: total > 0 ? totalCost / total : 0,
      avgDurationMs: total > 0 ? Math.round(totalDuration / total) : 0,
      results: this.results,
    };
  }

  saveReport(summary: EvalSummary, outputDir: string): void {
    const reportPath = path.join(outputDir, `eval-${summary.timestamp.replace(/[:.]/g, '-')}.json`);
    writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    console.log(`\n📊 Eval report saved: ${reportPath}`);
    console.log(`   Pass rate: ${summary.passRate.toFixed(1)}% (${summary.passedCases}/${summary.totalCases})`);
    console.log(`   Avg tokens: ${summary.avgTokens.toLocaleString()} | Avg cost: $${summary.avgCostUsd.toFixed(4)} | Avg time: ${summary.avgDurationMs}ms`);
  }
}

// ── Utility ───────────────────────────────────────────────────

/** Quick eval without running the full agent — just checks types/compile */
export async function quickEval(): Promise<{ ok: boolean; details: string[] }> {
  const details: string[] = [];
  
  // Check dist exists
  try {
    const { stat } = await import('node:fs/promises');
    await stat('dist');
    details.push('✅ dist/ exists');
  } catch {
    details.push('❌ dist/ missing — run npm run build');
    return { ok: false, details };
  }

  // Check key modules
  const modules = [
    'dist/agent/orchestrator.js',
    'dist/rag/local-rag.js',
    'dist/context/manager.js',
    'dist/observability/dashboard-service.js',
    'dist/code/snapshot-service.js',
  ];

  for (const mod of modules) {
    try {
      const { stat } = await import('node:fs/promises');
      await stat(mod);
      details.push(`✅ ${mod}`);
    } catch {
      details.push(`❌ ${mod} missing`);
    }
  }

  const allOk = details.every(d => d.startsWith('✅'));
  return { ok: allOk, details };
}
