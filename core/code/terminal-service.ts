import { spawn } from 'node:child_process';
import { assertInsideWorkspace } from './source.js';
import { UnifiedLogger } from '../observability/logger.js';
import { RiskPolicyEngine } from '../utils/risk-engine.js';
import { TracingService } from '../observability/tracing.js';
import { createSandbox, type SandboxExecutor, type SandboxMode, type SandboxResult } from './sandbox-executor.js';

export interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface TerminalServiceConfig {
  timeoutMs: number;
  outputLimit: number;
  allowedCommands: string[];
  deniedPatterns: RegExp[];
  logger?: UnifiedLogger;
  agentId?: string;
  riskEngine?: RiskPolicyEngine;
  tracing?: TracingService;
  sandboxMode?: SandboxMode;
}

export class TerminalService {
  private readonly config: TerminalServiceConfig;
  private readonly sandbox: SandboxExecutor | null;

  constructor(private readonly workspaceRoot = process.cwd(), config?: Partial<TerminalServiceConfig>) {
    this.config = {
      timeoutMs: 30_000,
      outputLimit: 20_000,
      allowedCommands: ['node', 'npm', 'npm.cmd', 'npx', 'npx.cmd', 'tsc', 'git'],
      deniedPatterns: [
        /\brm\s+-rf\s+\//i,
        /\bformat\b/i,
        /\bdel\s+\/s\b/i,
        /\bdrop\s+database\b/i,
        /\bshutdown\b/i,
        /\b(open|xdg-open|explorer|start)\b/i,
        /\b(electron-vite\s+preview|vite\s+preview|next\s+dev|vite\s+--host|--open)\b/i,
        /\bnpm(?:\.cmd)?\s+(?:run\s+)?(?:start|dev|preview|serve)\b/i,
        /\bnpx(?:\.cmd)?\s+(?:vite|next|electron-vite)\s+(?:dev|preview|start)\b/i,
        /\b(password|token|secret|api[_-]?key)=\S+/i,
      ],
      ...config,
    };

    // Initialize sandbox if mode is docker or auto
    const sandboxMode = this.config.sandboxMode ?? 'native';
    if (sandboxMode !== 'native') {
      try {
        this.sandbox = createSandbox(sandboxMode, {
          timeoutMs: this.config.timeoutMs,
          outputLimit: this.config.outputLimit,
        });
      } catch {
        this.sandbox = null;
      }
    } else {
      this.sandbox = null;
    }
  }

  async executeCommand(command: string, cwd = '.'): Promise<CommandResult> {
    const parsed = parseCommand(command);
    if (!parsed) {
      throw new Error('Command cannot be empty');
    }

    // Delegate to sandbox if available and active
    if (this.sandbox?.isSandboxed) {
      return this.executeSandboxed(command, cwd);
    }

    return this.execute(parsed.executable, parsed.args, cwd, command);
  }

  async execute(executable: string, args: string[] = [], cwd = '.', rawCommand?: string): Promise<CommandResult> {
    const riskEngine = this.config.riskEngine ?? new RiskPolicyEngine();
    const normalizedCommand = rawCommand ?? formatCommand(executable, args);
    const evaluation = riskEngine.evaluateToolCall('execute_command', { command: normalizedCommand });

    if (evaluation.level === 'blocked') {
      throw new Error(`Command blocked by risk policy: ${evaluation.reasons.join(', ')}`);
    }

    this.validateCommand(executable, args, normalizedCommand);
    const resolvedCwd = assertInsideWorkspace(this.workspaceRoot, cwd);
    const startedAt = Date.now();

    const span = this.config.tracing?.startTerminalSpan(normalizedCommand, resolvedCwd);

    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const child = spawn(executable, args, {
        cwd: resolvedCwd,
        shell: isWindows,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.config.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = this.limit(`${stdout}${chunk.toString('utf8')}`);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = this.limit(`${stderr}${chunk.toString('utf8')}`);
      });

      child.on('error', (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        const durationMs = Date.now() - startedAt;
        const redactedStdout = this.redact(stdout);
        const redactedStderr = this.redact(`${stderr}\n${error.message}`.trim());
        const redactedCommand = this.redact(normalizedCommand);

        if (this.config.logger) {
          this.config.logger.logCommandExecution(
            this.config.agentId ?? 'system',
            redactedCommand,
            resolvedCwd,
            null,
            durationMs,
            `stdout: ${redactedStdout.slice(0, 500)}\nstderr: ${redactedStderr.slice(0, 500)}`
          );
        }

        if (span && this.config.tracing) {
          this.config.tracing.recordTerminalResult(span, {
            exitCode: null,
            durationMs,
            timedOut,
          });
        }

        resolve({
          command: redactedCommand,
          cwd: resolvedCwd,
          exitCode: null,
          durationMs,
          stdout: redactedStdout,
          stderr: redactedStderr,
          timedOut,
        });
      });

      child.on('close', (exitCode) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        const durationMs = Date.now() - startedAt;
        const redactedStdout = this.redact(stdout);
        const redactedStderr = this.redact(stderr);
        const redactedCommand = this.redact(normalizedCommand);

        if (this.config.logger) {
          this.config.logger.logCommandExecution(
            this.config.agentId ?? 'system',
            redactedCommand,
            resolvedCwd,
            exitCode,
            durationMs,
            `stdout: ${redactedStdout.slice(0, 500)}\nstderr: ${redactedStderr.slice(0, 500)}`
          );
        }

        if (span && this.config.tracing) {
          this.config.tracing.recordTerminalResult(span, {
            exitCode,
            durationMs,
            timedOut,
          });
        }

        resolve({
          command: redactedCommand,
          cwd: resolvedCwd,
          exitCode,
          durationMs,
          stdout: redactedStdout,
          stderr: redactedStderr,
          timedOut,
        });
      });
    });
  }

  private validateCommand(executable: string, args: string[], rawCommand: string): void {
    if (!this.config.allowedCommands.includes(executable)) {
      throw new Error(`Command is not allowed: ${executable}`);
    }

    if (args.some((arg) => SHELL_OPERATORS.has(arg))) {
      throw new Error('Shell chaining and redirection operators are not allowed');
    }

    for (const pattern of this.config.deniedPatterns) {
      if (pattern.test(rawCommand)) {
        throw new Error(`Command is denied by policy: ${pattern.source}`);
      }
    }
  }

  private limit(value: string): string {
    if (value.length <= this.config.outputLimit) {
      return value;
    }
    return `${value.slice(0, this.config.outputLimit)}\n[output truncated]`;
  }

  private redact(value: string): string {
    return value.replace(/(password|token|secret|api[_-]?key)=\S+/gi, '$1=[REDACTED]');
  }

  /**
   * Execute a command through the Docker sandbox.
   */
  private async executeSandboxed(command: string, cwd: string): Promise<CommandResult> {
    const riskEngine = this.config.riskEngine ?? new RiskPolicyEngine();
    const evaluation = riskEngine.evaluateToolCall('execute_command', { command });

    if (evaluation.level === 'blocked') {
      throw new Error(`Command blocked by risk policy: ${evaluation.reasons.join(', ')}`);
    }

    const resolvedCwd = assertInsideWorkspace(this.workspaceRoot, cwd);
    const span = this.config.tracing?.startTerminalSpan(command, resolvedCwd);

    const sandboxResult: SandboxResult = await this.sandbox!.execute(command, cwd, this.workspaceRoot);

    const redactedCommand = this.redact(command);
    const redactedStdout = this.redact(sandboxResult.stdout);
    const redactedStderr = this.redact(sandboxResult.stderr);

    if (this.config.logger) {
      this.config.logger.logCommandExecution(
        this.config.agentId ?? 'system',
        `[sandbox] ${redactedCommand}`,
        resolvedCwd,
        sandboxResult.exitCode,
        sandboxResult.durationMs,
        `stdout: ${redactedStdout.slice(0, 500)}\nstderr: ${redactedStderr.slice(0, 500)}`
      );
    }

    if (span && this.config.tracing) {
      this.config.tracing.recordTerminalResult(span, {
        exitCode: sandboxResult.exitCode,
        durationMs: sandboxResult.durationMs,
        timedOut: sandboxResult.timedOut,
      });
    }

    return {
      command: redactedCommand,
      cwd: resolvedCwd,
      exitCode: sandboxResult.exitCode,
      durationMs: sandboxResult.durationMs,
      stdout: redactedStdout,
      stderr: redactedStderr,
      timedOut: sandboxResult.timedOut,
    };
  }
}

const SHELL_OPERATORS = new Set(['&&', '||', ';', '|', '>', '>>', '<', '1>', '2>']);

function formatCommand(executable: string, args: string[]): string {
  return [executable, ...args.map((arg) => quoteIfNeeded(arg))].join(' ').trim();
}

function quoteIfNeeded(value: string): string {
  if (!/\s/.test(value) && !value.includes('"')) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function parseCommand(command: string): { executable: string; args: string[] } | null {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      continue;
    }

    if (quote !== null && char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && quote === null) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (quote !== null) {
    throw new Error('Command contains an unterminated quoted string');
  }

  if (current) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    return null;
  }

  const [executable, ...args] = tokens;
  return { executable, args };
}
