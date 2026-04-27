/**
 * Babysit PR — monitors a PR and auto-fixes issues.
 *
 * Watches for CI failures, test regressions, and lint errors.
 * Can be triggered via CLI or MCP tool.
 */
import { execSync } from 'node:child_process';

export interface PRMonitorConfig {
  /** PR number or URL */
  pr: string;
  /** Polling interval in ms (default: 30000) */
  intervalMs: number;
  /** Auto-fix on failure (default: false) */
  autoFix: boolean;
  /** Max auto-fix attempts (default: 3) */
  maxFixes: number;
}

export interface PRCheckResult {
  status: 'pass' | 'fail' | 'running';
  checks: Array<{ name: string; status: string; details?: string }>;
  fixable: boolean;
}

/**
 * Check PR status by running local CI checks.
 * In a real scenario, this would query GitHub/GitLab API.
 */
export function checkPR(_config: PRMonitorConfig): PRCheckResult {
  const checks: PRCheckResult['checks'] = [];

  // Typecheck
  try {
    execSync('npx tsc --noEmit', { stdio: 'pipe', timeout: 30000 });
    checks.push({ name: 'typecheck', status: 'pass' });
  } catch (e) {
    const err = e as any;
    checks.push({ name: 'typecheck', status: 'fail', details: err.stderr?.toString().slice(0, 500) || err.message });
  }

  // Build
  try {
    execSync('npm run build', { stdio: 'pipe', timeout: 60000 });
    checks.push({ name: 'build', status: 'pass' });
  } catch (e) {
    const err = e as any;
    checks.push({ name: 'build', status: 'fail', details: err.stderr?.toString().slice(0, 500) || err.message });
  }

  // Tests
  try {
    execSync('npm test', { stdio: 'pipe', timeout: 120000 });
    checks.push({ name: 'test', status: 'pass' });
  } catch (e) {
    const err = e as any;
    checks.push({ name: 'test', status: 'fail', details: err.stderr?.toString().slice(0, 500) || err.message });
  }

  const failed = checks.filter(c => c.status === 'fail');
  return {
    status: failed.length === 0 ? 'pass' : 'fail',
    checks,
    fixable: failed.length > 0 && failed.every(c => c.name !== 'test'), // Tests may need human review
  };
}

/**
 * Run a babysit cycle: check → auto-fix → re-check.
 */
export async function babysitPR(config: PRMonitorConfig): Promise<{ success: boolean; attempts: number; report: string }> {
  let attempts = 0;
  const reports: string[] = [];

  while (attempts < (config.maxFixes || 3)) {
    attempts++;
    const result = checkPR(config);

    if (result.status === 'pass') {
      reports.push(`✅ Attempt ${attempts}: All checks pass`);
      return { success: true, attempts, report: reports.join('\n') };
    }

    const failures = result.checks.filter(c => c.status === 'fail').map(c => c.name).join(', ');
    reports.push(`❌ Attempt ${attempts}: Failed checks: ${failures}`);

    if (!config.autoFix || !result.fixable) break;

    // Try auto-fix: run lint autofix
    try {
      execSync('npx eslint --fix src/', { stdio: 'pipe', timeout: 30000 });
      reports.push('  🔧 Applied auto-fix (eslint --fix)');
    } catch { /* eslint may fail on some files */ }

    // Wait before re-checking
    await new Promise(r => setTimeout(r, config.intervalMs || 30000));
  }

  return { success: false, attempts, report: reports.join('\n') };
}

// ── Issue Digest ──────────────────────────────────────────────

export interface IssueDigest {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  complexity: 'simple' | 'medium' | 'complex';
}

/**
 * Generate a structured issue digest from a description.
 * In a real scenario, this would use LLM to analyze the issue.
 */
export function generateIssueDigest(description: string, files: string[]): IssueDigest {
  const keywords = description.toLowerCase();

  // Complexity heuristic
  let complexity: IssueDigest['complexity'] = 'simple';
  if (files.length > 5 || keywords.includes('migration') || keywords.includes('refactor')) {
    complexity = 'complex';
  } else if (files.length > 2 || keywords.includes('api') || keywords.includes('breaking')) {
    complexity = 'medium';
  }

  // Labels heuristic
  const labels: string[] = [];
  if (keywords.includes('bug') || keywords.includes('fix') || keywords.includes('broken')) labels.push('bug');
  if (keywords.includes('feature') || keywords.includes('add') || keywords.includes('new')) labels.push('enhancement');
  if (keywords.includes('docs') || keywords.includes('readme')) labels.push('documentation');
  if (complexity === 'complex') labels.push('complex');

  return {
    title: description.slice(0, 80),
    body: `## Descrição\n${description}\n\n## Arquivos afetados\n${files.map(f => `- \`${f}\``).join('\n')}`,
    labels,
    assignees: [],
    complexity,
  };
}

// ── Remote Test Execution ─────────────────────────────────────

export interface RemoteTestConfig {
  /** Command to run remotely */
  command: string;
  /** Remote host (default: localhost) */
  host?: string;
  /** Timeout in ms */
  timeoutMs: number;
}

/**
 * Execute tests in a remote/sandboxed environment.
 * This is a placeholder — real implementation would use SSH or CI API.
 */
export async function runRemoteTests(config: RemoteTestConfig): Promise<{
  success: boolean;
  output: string;
  durationMs: number;
}> {
  const started = Date.now();
  try {
    const output = execSync(config.command, {
      stdio: 'pipe',
      timeout: config.timeoutMs,
      cwd: process.cwd(),
    });
    return {
      success: true,
      output: output.toString(),
      durationMs: Date.now() - started,
    };
  } catch (e) {
    const err = e as any;
    return {
      success: false,
      output: err.stderr?.toString() || err.message,
      durationMs: Date.now() - started,
    };
  }
}

// ── Frontend Design Guidance ──────────────────────────────────

export const FRONTEND_DESIGN_GUIDE = `
## Frontend Design Principles (bflow-agent-llm)

### Avoid Generic AI Aesthetics
- ❌ No purple gradients on dark backgrounds
- ❌ No generic "futuristic" neon glows
- ❌ No default shadcn/radix without customization
- ✅ Use brand colors consistently
- ✅ Purposeful whitespace
- ✅ Typography hierarchy (heading → body → caption)

### Dashboard Design
- Cards should be scannable: icon + label + value
- Charts should tell a story, not just exist
- Use consistent spacing (8px grid)
- Color coding: green=success, red=error, yellow=warning, blue=info

### Component Design
- Button variants: primary (filled), secondary (outline), ghost (text-only), danger (red)
- Input fields: clear label, placeholder, error state, focus ring
- Tables: zebra striping optional, header sticky, hover highlight
- Badges: small, rounded, color-coded by status

### Accessibility
- All interactive elements need focus states
- Color should not be the only indicator of meaning
- Minimum contrast ratio 4.5:1 for text
`;
