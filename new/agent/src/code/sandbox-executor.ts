/**
 * Sandbox Executor — isolates terminal command execution.
 *
 * Provides two implementations:
 * - `DockerSandboxExecutor`: runs commands inside a Docker container with
 *   resource limits, network isolation, and read-only workspace mount.
 * - `NativeSandboxExecutor`: wraps the existing host-based execution as a
 *   transparent fallback when Docker is not available.
 *
 * The `createSandbox` factory auto-detects Docker availability.
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { assertInsideWorkspace } from './source.js';

// ── Interfaces ────────────────────────────────────────────────

export interface SandboxConfig {
  /** Docker image to use for sandboxed execution */
  image: string;
  /** Memory limit (e.g., '512m') */
  memoryLimit: string;
  /** CPU limit (e.g., '1.0') */
  cpuLimit: string;
  /** Disable network inside container */
  networkDisabled: boolean;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Output character limit */
  outputLimit: number;
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  sandboxed: boolean;
}

export interface SandboxExecutor {
  execute(command: string, cwd: string, workspaceRoot: string): Promise<SandboxResult>;
  readonly isSandboxed: boolean;
}

// ── Docker Detection ──────────────────────────────────────────

let _dockerAvailable: boolean | null = null;

export function isDockerAvailable(): boolean {
  if (_dockerAvailable !== null) return _dockerAvailable;

  try {
    execSync('docker info', { stdio: 'ignore', timeout: 5000, windowsHide: true });
    _dockerAvailable = true;
  } catch {
    _dockerAvailable = false;
  }

  return _dockerAvailable;
}

/** Reset cached detection (useful for tests) */
export function resetDockerDetection(): void {
  _dockerAvailable = null;
}

// ── Docker Sandbox Executor ───────────────────────────────────

const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  image: 'node:22-slim',
  memoryLimit: '512m',
  cpuLimit: '1.0',
  networkDisabled: true,
  timeoutMs: 30_000,
  outputLimit: 20_000,
};

export class DockerSandboxExecutor implements SandboxExecutor {
  readonly isSandboxed = true;
  private readonly config: SandboxConfig;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config };
  }

  async execute(command: string, cwd: string, workspaceRoot: string): Promise<SandboxResult> {
    const resolvedCwd = assertInsideWorkspace(workspaceRoot, cwd);
    const relativeCwd = path.relative(workspaceRoot, resolvedCwd).replace(/\\/g, '/') || '.';
    const containerWorkdir = `/workspace/${relativeCwd}`;

    const dockerArgs = [
      'run',
      '--rm',
      `--memory=${this.config.memoryLimit}`,
      `--cpus=${this.config.cpuLimit}`,
      `--stop-timeout=${Math.ceil(this.config.timeoutMs / 1000)}`,
      ...(this.config.networkDisabled ? ['--network=none'] : []),
      '-v', `${workspaceRoot}:/workspace:ro`,
      '-w', containerWorkdir,
      this.config.image,
      'sh', '-c', command,
    ];

    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    return new Promise<SandboxResult>((resolve) => {
      const child = spawn('docker', dockerArgs, {
        shell: false,
        windowsHide: true,
      });

      let settled = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.config.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (stdout.length > this.config.outputLimit) {
          stdout = stdout.slice(0, this.config.outputLimit) + '\n[output truncated]';
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (stderr.length > this.config.outputLimit) {
          stderr = stderr.slice(0, this.config.outputLimit) + '\n[output truncated]';
        }
      });

      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          timedOut,
          sandboxed: true,
        });
      };

      child.on('error', () => finish(null));
      child.on('close', (code) => finish(code));
    });
  }
}

// ── Native Sandbox Executor (Fallback) ────────────────────────

export class NativeSandboxExecutor implements SandboxExecutor {
  readonly isSandboxed = false;

  constructor(
    private readonly timeoutMs = 30_000,
    private readonly outputLimit = 20_000
  ) {}

  async execute(command: string, cwd: string, workspaceRoot: string): Promise<SandboxResult> {
    const resolvedCwd = assertInsideWorkspace(workspaceRoot, cwd);
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Parse command into executable + args
    const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    if (parts.length === 0) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'Empty command',
        durationMs: 0,
        timedOut: false,
        sandboxed: false,
      };
    }

    const [executable, ...args] = parts.map((p) => p.replace(/^"|"$/g, ''));

    return new Promise<SandboxResult>((resolve) => {
      const child = spawn(executable, args, {
        cwd: resolvedCwd,
        shell: false,
        windowsHide: true,
      });

      let settled = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
        if (stdout.length > this.outputLimit) {
          stdout = stdout.slice(0, this.outputLimit) + '\n[output truncated]';
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (stderr.length > this.outputLimit) {
          stderr = stderr.slice(0, this.outputLimit) + '\n[output truncated]';
        }
      });

      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          timedOut,
          sandboxed: false,
        });
      };

      child.on('error', (error) => {
        stderr += `\n${error.message}`;
        finish(null);
      });
      child.on('close', (code) => finish(code));
    });
  }
}

// ── Factory ───────────────────────────────────────────────────

export type SandboxMode = 'docker' | 'native' | 'auto';

/**
 * Creates a sandbox executor based on the requested mode.
 * - `docker`: always use Docker (throws if unavailable)
 * - `native`: always use host execution
 * - `auto`: use Docker if available, otherwise fallback to native
 */
export function createSandbox(mode: SandboxMode = 'auto', config?: Partial<SandboxConfig>): SandboxExecutor {
  switch (mode) {
    case 'docker':
      if (!isDockerAvailable()) {
        throw new Error('Docker is not available. Install Docker Desktop or switch to sandbox mode "auto".');
      }
      return new DockerSandboxExecutor(config);

    case 'native':
      return new NativeSandboxExecutor(config?.timeoutMs, config?.outputLimit);

    case 'auto':
      if (isDockerAvailable()) {
        return new DockerSandboxExecutor(config);
      }
      return new NativeSandboxExecutor(config?.timeoutMs, config?.outputLimit);
  }
}
