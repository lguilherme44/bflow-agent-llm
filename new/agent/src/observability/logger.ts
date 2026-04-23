import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { redactSecrets } from '../llm/redaction';
import { ToolResult } from '../types';

export interface LogEntry {
  timestamp: string;
  type: 'event' | 'llm' | 'tool' | 'command' | 'file';
  agentId?: string;
  payload: Record<string, unknown>;
}

export interface LoggerConfig {
  logDirectory: string;
}

export class UnifiedLogger {
  private readonly logDirectory: string;

  constructor(config?: Partial<LoggerConfig>) {
    this.logDirectory = config?.logDirectory ?? path.join(process.cwd(), '.agent', 'logs');
  }

  private async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.logDirectory, { recursive: true });
  }

  private async appendLog(agentId: string, type: LogEntry['type'], payload: Record<string, unknown>): Promise<void> {
    await this.ensureDirectory();
    
    // We redact the payload before writing to the log
    const stringifiedPayload = JSON.stringify(payload, (_key, value) => {
      if (typeof value === 'string') {
        return redactSecrets(value);
      }
      return value;
    });

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      type,
      agentId,
      payload: JSON.parse(stringifiedPayload), // Re-parse so the entire line is a valid JSON object
    };

    const filePath = path.join(this.logDirectory, `${agentId}.jsonl`);
    const line = JSON.stringify(entry) + '\n';
    
    // Fire and forget writing to avoid blocking the main loop
    // But catch any error to prevent unhandled rejections
    fs.appendFile(filePath, line).catch((err) => {
      console.error(`[UnifiedLogger] Failed to write log for agent ${agentId}:`, err);
    });
  }

  logEvent(agentId: string, eventName: string, data?: Record<string, unknown>): void {
    this.appendLog(agentId, 'event', { event: eventName, ...data });
  }

  logLLMResponse(
    agentId: string,
    provider: string,
    model: string,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
    latencyMs?: number,
    estimatedCostUsd?: number
  ): void {
    this.appendLog(agentId, 'llm', {
      provider,
      model,
      usage,
      latencyMs,
      estimatedCostUsd,
    });
  }

  logToolExecution(
    agentId: string,
    toolName: string,
    toolCallId: string,
    result: ToolResult
  ): void {
    this.appendLog(agentId, 'tool', {
      toolName,
      toolCallId,
      success: result.success,
      attempts: result.attempts,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      recoverable: result.recoverable,
      errorCode: result.errorCode,
      error: result.error,
    });
  }

  logCommandExecution(
    agentId: string,
    command: string,
    cwd: string,
    exitCode: number | null,
    durationMs: number,
    outputSummary: string
  ): void {
    this.appendLog(agentId, 'command', {
      command,
      cwd,
      exitCode,
      durationMs,
      outputSummary,
    });
  }

  logFileAccess(
    agentId: string,
    action: 'read' | 'write' | 'delete',
    filepath: string,
    details?: string
  ): void {
    this.appendLog(agentId, 'file', {
      action,
      filepath,
      details,
    });
  }
}
