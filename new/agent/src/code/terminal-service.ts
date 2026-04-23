import { spawn } from 'node:child_process';
import { assertInsideWorkspace } from './source.js';
import { UnifiedLogger } from '../observability/logger.js';
import { RiskPolicyEngine } from '../utils/risk-engine.js';

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
    const riskEngine = this.config.riskEngine ?? new RiskPolicyEngine();
    const evaluation = riskEngine.evaluateToolCall('execute_command', { command });

    if (evaluation.level === 'blocked') {
      throw new Error(`Command blocked by risk policy: ${evaluation.reasons.join(', ')}`);
    }

    this.validateCommand(command);
    const resolvedCwd = assertInsideWorkspace(this.workspaceRoot, cwd);
    const startedAt = Date.now();

    return new Promise((resolve) => {
      const child = spawn(command, {
        cwd: resolvedCwd,
        shell: true,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, this.config.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = this.limit(`${stdout}${chunk.toString('utf8')}`);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = this.limit(`${stderr}${chunk.toString('utf8')}`);
      });

      child.on('close', (exitCode) => {
        clearTimeout(timeout);
        const durationMs = Date.now() - startedAt;
        const redactedStdout = this.redact(stdout);
        const redactedStderr = this.redact(stderr);
        const redactedCommand = this.redact(command);

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

  private validateCommand(command: string): void {
    const executable = command.trim().split(/\s+/)[0];
    if (!this.config.allowedCommands.includes(executable)) {
      throw new Error(`Command is not allowed: ${executable}`);
    }

    for (const pattern of this.config.deniedPatterns) {
      if (pattern.test(command)) {
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
