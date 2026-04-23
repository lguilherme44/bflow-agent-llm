import { spawn } from 'node:child_process';
import { assertInsideWorkspace } from './source.js';
import { UnifiedLogger } from '../observability/logger.js';
import { RiskPolicyEngine } from '../utils/risk-engine.js';
import { TracingService } from '../observability/tracing.js';

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
}

export class TerminalService {
  private readonly config: TerminalServiceConfig;

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
        /\b(password|token|secret|api[_-]?key)=\S+/i,
      ],
      ...config,
    };
  }

  async executeCommand(command: string, cwd = '.'): Promise<CommandResult> {
    const parsed = parseCommand(command);
    if (!parsed) {
      throw new Error('Command cannot be empty');
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
      const child = spawn(executable, args, {
        cwd: resolvedCwd,
        shell: false,
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
