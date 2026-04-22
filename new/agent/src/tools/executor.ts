import { setTimeout as sleep } from 'node:timers/promises';
import {
  AgentState,
  JSONSchema,
  JsonValue,
  RollbackResult,
  ToolCall,
  ToolDefinition,
  ToolErrorCode,
  ToolExecutionContext,
  ToolResult,
} from '../types';
import { toJsonValue } from '../utils/json';
import { ToolRegistry } from './registry';

export interface ExecutorConfig {
  defaultTimeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMultiplier: number;
  retryMaxDelayMs: number;
  retryJitterRatio: number;
  enableRollback: boolean;
}

export interface ToolExecutorHooks {
  onToolStart?: (toolCall: ToolCall, attempt: number) => void | Promise<void>;
  onToolRetry?: (toolCall: ToolCall, attempt: number, error: Error, delayMs: number) => void | Promise<void>;
  onToolSuccess?: (toolCall: ToolCall, result: ToolResult) => void | Promise<void>;
  onToolFailure?: (toolCall: ToolCall, result: ToolResult) => void | Promise<void>;
  onRollback?: (toolCall: ToolCall, result: RollbackResult) => void | Promise<void>;
}

class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolValidationError';
  }
}

class ToolTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Timeout after ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
  }
}

export class ToolExecutor {
  private readonly config: ExecutorConfig;
  private readonly hooks: ToolExecutorHooks;

  constructor(
    private readonly registry: ToolRegistry,
    config?: Partial<ExecutorConfig>,
    hooks?: ToolExecutorHooks
  ) {
    this.config = {
      defaultTimeoutMs: 30_000,
      maxRetries: 2,
      retryBaseDelayMs: 250,
      retryMultiplier: 2,
      retryMaxDelayMs: 5_000,
      retryJitterRatio: 0.2,
      enableRollback: true,
      ...config,
    };
    this.hooks = hooks ?? {};
  }

  async execute(state: AgentState, toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.registry.get(toolCall.toolName);
    const startTime = Date.now();

    if (!tool) {
      return this.createErrorResult(toolCall, {
        error: `Tool "${toolCall.toolName}" not found`,
        durationMs: Date.now() - startTime,
        attempts: 0,
        errorCode: 'TOOL_NOT_FOUND',
        recoverable: true,
        nextActionHint: 'Choose one of the registered tools from the tool list.',
      });
    }

    const maxRetries = tool.retryPolicy?.maxRetries ?? this.config.maxRetries;
    let lastError = new Error('Unknown tool execution error');
    let lastCode: ToolErrorCode = 'EXECUTION_ERROR';
    let timedOut = false;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      attemptsMade = attempt;
      await this.hooks.onToolStart?.(toolCall, attempt);

      try {
        this.validateArguments(toolCall.arguments, tool.schema.parameters);
        const data = await this.executeWithTimeout(state, toolCall, tool);
        const result: ToolResult = {
          toolCallId: toolCall.id,
          success: true,
          data: toJsonValue(data),
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          attempts: attempt,
          timedOut: false,
          recoverable: true,
        };

        await this.hooks.onToolSuccess?.(toolCall, result);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        lastCode = this.classifyError(lastError, tool);
        timedOut = lastCode === 'TIMEOUT';

        if (!this.shouldRetry(lastCode, tool) || attempt > maxRetries) {
          break;
        }

        const delayMs = this.getBackoffDelay(attempt);
        await this.hooks.onToolRetry?.(toolCall, attempt, lastError, delayMs);
        await sleep(delayMs);
      }
    }

    const result = this.createErrorResult(toolCall, {
      error: lastError.message,
      durationMs: Date.now() - startTime,
      attempts: attemptsMade,
      errorCode: lastCode,
      recoverable: this.isRecoverable(lastCode),
      timedOut,
      nextActionHint: this.nextActionHint(lastCode, lastError.message),
    });

    if (this.config.enableRollback && tool.rollback && (tool.critical || lastCode === 'CRITICAL_ERROR')) {
      result.rollback = await this.rollback(state, toolCall, result.data);
    }

    await this.hooks.onToolFailure?.(toolCall, result);
    return result;
  }

  async rollback(state: AgentState, toolCall: ToolCall, previousResult: JsonValue): Promise<RollbackResult> {
    const timestamp = new Date().toISOString();
    const tool = this.registry.get(toolCall.toolName);

    if (!this.config.enableRollback || !tool?.rollback) {
      const skipped: RollbackResult = {
        attempted: false,
        success: false,
        error: 'Rollback is not enabled or the tool does not provide rollback',
        timestamp,
      };
      await this.hooks.onRollback?.(toolCall, skipped);
      return skipped;
    }

    const controller = new AbortController();
    try {
      const context: ToolExecutionContext = { state, signal: controller.signal };
      await this.withTimeout(
        tool.rollback(toolCall.arguments, previousResult, context),
        tool.timeoutMs ?? this.config.defaultTimeoutMs,
        controller
      );

      const result: RollbackResult = {
        attempted: true,
        success: true,
        timestamp: new Date().toISOString(),
      };
      await this.hooks.onRollback?.(toolCall, result);
      return result;
    } catch (error) {
      const result: RollbackResult = {
        attempted: true,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
      await this.hooks.onRollback?.(toolCall, result);
      return result;
    }
  }

  private async executeWithTimeout(
    state: AgentState,
    toolCall: ToolCall,
    tool: ToolDefinition
  ): Promise<unknown> {
    const timeoutMs = tool.timeoutMs ?? this.config.defaultTimeoutMs;
    const controller = new AbortController();
    const context: ToolExecutionContext = { state, signal: controller.signal };

    return this.withTimeout(tool.execute(toolCall.arguments, context), timeoutMs, controller);
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    controller: AbortController
  ): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new ToolTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private validateArguments(args: Record<string, JsonValue>, schema: JSONSchema): void {
    const errors: string[] = [];
    this.validateValue(args, schema, 'arguments', errors);

    if (errors.length > 0) {
      throw new ToolValidationError(errors.join('; '));
    }
  }

  private validateValue(value: JsonValue, schema: JSONSchema, path: string, errors: string[]): void {
    if (!schema.type) {
      return;
    }

    if (!this.matchesType(value, schema.type)) {
      errors.push(`${path} expected ${schema.type}, got ${Array.isArray(value) ? 'array' : typeof value}`);
      return;
    }

    if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
      errors.push(`${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    }

    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path} must have at least ${schema.minLength} characters`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path} must have at most ${schema.maxLength} characters`);
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push(`${path} does not match pattern ${schema.pattern}`);
      }
    }

    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path} must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path} must be <= ${schema.maximum}`);
      }
    }

    if (Array.isArray(value) && schema.items) {
      value.forEach((item, index) => this.validateValue(item, schema.items as JSONSchema, `${path}[${index}]`, errors));
    }

    if (isJsonObject(value) && schema.type === 'object') {
      const required = schema.required ?? [];
      for (const key of required) {
        if (!(key in value)) {
          errors.push(`${path}.${key} is required`);
        }
      }

      const properties = schema.properties ?? {};
      for (const [key, item] of Object.entries(value)) {
        const propertySchema = properties[key];
        if (propertySchema) {
          this.validateValue(item, propertySchema, `${path}.${key}`, errors);
        } else if (schema.additionalProperties === false) {
          errors.push(`${path}.${key} is not allowed`);
        } else if (typeof schema.additionalProperties === 'object') {
          this.validateValue(item, schema.additionalProperties, `${path}.${key}`, errors);
        }
      }
    }
  }

  private matchesType(value: JsonValue, type: string): boolean {
    switch (type) {
      case 'object':
        return isJsonObject(value);
      case 'array':
        return Array.isArray(value);
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value);
      case 'number':
        return typeof value === 'number';
      case 'string':
        return typeof value === 'string';
      case 'boolean':
        return typeof value === 'boolean';
      case 'null':
        return value === null;
      default:
        return true;
    }
  }

  private classifyError(error: Error, tool: ToolDefinition): ToolErrorCode {
    if (error instanceof ToolValidationError) {
      return 'VALIDATION_ERROR';
    }

    if (error instanceof ToolTimeoutError) {
      return 'TIMEOUT';
    }

    if (tool.critical) {
      return 'CRITICAL_ERROR';
    }

    const lower = error.message.toLowerCase();
    if (lower.includes('econnreset') || lower.includes('rate limit') || lower.includes('temporar')) {
      return 'TRANSIENT_ERROR';
    }

    return 'EXECUTION_ERROR';
  }

  private shouldRetry(code: ToolErrorCode, tool: ToolDefinition): boolean {
    if (code === 'VALIDATION_ERROR' || code === 'TOOL_NOT_FOUND' || code === 'CRITICAL_ERROR') {
      return false;
    }

    if (code === 'TIMEOUT') {
      return tool.retryPolicy?.retryTimeouts ?? true;
    }

    if (code === 'TRANSIENT_ERROR') {
      return tool.retryPolicy?.retryTransientErrors ?? true;
    }

    return false;
  }

  private isRecoverable(code: ToolErrorCode): boolean {
    return code !== 'CRITICAL_ERROR' && code !== 'ROLLBACK_FAILED';
  }

  private nextActionHint(code: ToolErrorCode, message: string): string {
    switch (code) {
      case 'VALIDATION_ERROR':
        return `Fix the arguments and retry. ${message}`;
      case 'TIMEOUT':
        return 'Try a narrower operation, increase timeout policy, or ask for human help.';
      case 'TRANSIENT_ERROR':
        return 'Retry later or choose a more stable tool/source.';
      case 'CRITICAL_ERROR':
        return 'Stop and inspect rollback/side effects before continuing.';
      case 'TOOL_NOT_FOUND':
        return 'Use only registered tool names.';
      case 'HUMAN_REJECTED':
        return 'Explain the rejection to the LLM and choose a non-destructive alternative.';
      case 'EXECUTION_ERROR':
      case 'ROLLBACK_FAILED':
        return 'Inspect the error and choose a corrective next action.';
    }
  }

  private createErrorResult(
    toolCall: ToolCall,
    input: {
      error: string;
      durationMs: number;
      attempts: number;
      errorCode: ToolErrorCode;
      recoverable: boolean;
      timedOut?: boolean;
      nextActionHint?: string;
    }
  ): ToolResult {
    return {
      toolCallId: toolCall.id,
      success: false,
      data: null,
      error: input.error,
      durationMs: input.durationMs,
      timestamp: new Date().toISOString(),
      attempts: input.attempts,
      timedOut: input.timedOut ?? false,
      recoverable: input.recoverable,
      errorCode: input.errorCode,
      nextActionHint: input.nextActionHint,
    };
  }

  private getBackoffDelay(attempt: number): number {
    const exponential = this.config.retryBaseDelayMs * this.config.retryMultiplier ** (attempt - 1);
    const capped = Math.min(exponential, this.config.retryMaxDelayMs);
    const jitter = capped * this.config.retryJitterRatio * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(capped + jitter));
  }
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
