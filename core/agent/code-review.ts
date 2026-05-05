/**
 * Advanced Code Review — multi-agent review with confidence-based scoring.
 *
 * Inspired by Claude Code's code-review plugin (5 parallel agents)
 * and Codex's granular review skills.
 *
 * Runs N review agents in parallel, each specialized in a different aspect,
 * then aggregates results with confidence scoring to filter false positives.
 */

export interface ReviewAgent {
  name: string;
  focus: string;
  prompt: string;
  /** Weight for confidence scoring (0-1). Higher = more trusted. */
  confidenceWeight: number;
}

export interface ReviewFinding {
  agent: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
  confidence: number; // 0-1
}

export interface ReviewResult {
  findings: ReviewFinding[];
  score: number; // 0-100 overall quality score
  summary: string;
  agentBreakdown: Array<{ agent: string; findings: number; avgConfidence: number }>;
}

export const REVIEW_AGENTS: ReviewAgent[] = [
  {
    name: 'breaking-changes',
    focus: 'Detecta breaking changes em APIs, tipos exportados, e contratos',
    confidenceWeight: 0.9,
    prompt: `You are a breaking-change detection specialist. Review the diff and identify:
- Changed function signatures (params added/removed/reordered)
- Changed return types
- Removed exports or public APIs
- Changed type/interface fields
- Changed default values or behavior

For each finding, assign confidence (0-1) based on how certain you are it's a real breaking change.`,
  },
  {
    name: 'silent-failures',
    focus: 'Detecta falhas silenciosas: try/catch vazios, erros engolidos, promises sem catch',
    confidenceWeight: 0.85,
    prompt: `You are a silent-failure detection specialist. Review the diff and identify:
- Empty catch blocks
- Errors that are caught but not logged or handled
- Promises without .catch() or try/catch
- Functions that can fail silently (no error propagation)
- Missing error handling on async operations

For each finding, assign confidence (0-1).`,
  },
  {
    name: 'type-safety',
    focus: 'TypeScript type safety: any usage, missing types, unsafe casts',
    confidenceWeight: 0.8,
    prompt: `You are a TypeScript type-safety specialist. Review the diff and identify:
- Use of 'any' type (should use 'unknown' or proper types)
- Unsafe type assertions (as Type without validation)
- Missing type annotations on function parameters/returns
- @ts-ignore or @ts-expect-error comments
- Non-null assertions (!) without guards

For each finding, assign confidence (0-1).`,
  },
  {
    name: 'code-quality',
    focus: 'Qualidade geral: complexidade, duplicação, naming, padrões',
    confidenceWeight: 0.7,
    prompt: `You are a code quality specialist. Review the diff and identify:
- Overly complex functions (>50 lines or deep nesting)
- Code duplication
- Poor naming (too short, unclear, inconsistent)
- Missing comments on complex logic
- Functions doing too many things (single responsibility violation)

For each finding, assign confidence (0-1).`,
  },
];

/** Default confidence threshold — findings below this are filtered out */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Filter findings by confidence threshold and sort by severity * confidence.
 */
export function filterAndRankFindings(
  findings: ReviewFinding[],
  threshold = DEFAULT_CONFIDENCE_THRESHOLD
): ReviewFinding[] {
  const severityOrder: Record<string, number> = {
    critical: 5, high: 4, medium: 3, low: 2, info: 1,
  };

  return findings
    .filter(f => f.confidence >= threshold)
    .sort((a, b) => {
      const scoreA = (severityOrder[a.severity] || 0) * a.confidence;
      const scoreB = (severityOrder[b.severity] || 0) * b.confidence;
      return scoreB - scoreA;
    });
}

/**
 * Calculate overall code quality score (0-100).
 * Deducts points based on weighted findings.
 */
export function calculateQualityScore(
  findings: ReviewFinding[],
  agents: ReviewAgent[]
): number {
  const severityDeduction: Record<string, number> = {
    critical: 25, high: 15, medium: 8, low: 3, info: 1,
  };

  let score = 100;
  for (const finding of findings) {
    const agent = agents.find(a => a.name === finding.agent);
    const weight = agent?.confidenceWeight ?? 0.5;
    const deduction = (severityDeduction[finding.severity] || 1) * finding.confidence * weight;
    score -= deduction;
  }

  return Math.max(0, Math.round(score));
}

/**
 * Build agent breakdown for review summary.
 */
export function buildAgentBreakdown(
  findings: ReviewFinding[],
  agents: ReviewAgent[]
): Array<{ agent: string; findings: number; avgConfidence: number }> {
  return agents.map(agent => {
    const agentFindings = findings.filter(f => f.agent === agent.name);
    const avgConf = agentFindings.length > 0
      ? agentFindings.reduce((s, f) => s + f.confidence, 0) / agentFindings.length
      : 0;
    return {
      agent: agent.name,
      findings: agentFindings.length,
      avgConfidence: Math.round(avgConf * 100) / 100,
    };
  });
}
