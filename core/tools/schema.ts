import {
  JsonValue,
  RecoverableToolError,
  ToolDefinition,
  ToolExample,
  ToolFunction,
  ToolSchema,
} from '../types/index.js';

export class ToolBuilder {
  private readonly schema: Partial<ToolSchema> = {
    examples: [],
    failureModes: [],
    recoverableErrors: [],
  };

  private executeFn?: ToolFunction;
  private rollbackFn?: ToolDefinition['rollback'];
  private timeoutMsValue?: number;
  private retryPolicyValue?: ToolDefinition['retryPolicy'];
  private criticalValue?: boolean;

  name(name: string): this {
    this.schema.name = name;
    return this;
  }

  summary(summary: string): this {
    this.schema.summary = summary;
    return this;
  }

  description(description: string): this {
    this.schema.description = description;
    return this;
  }

  whenToUse(value: string): this {
    this.schema.whenToUse = value;
    return this;
  }

  whenNotToUse(value: string): this {
    this.schema.whenNotToUse = value;
    return this;
  }

  expectedOutput(value: string): this {
    this.schema.expectedOutput = value;
    return this;
  }

  failureMode(value: string): this {
    this.schema.failureModes = [...(this.schema.failureModes ?? []), value];
    return this;
  }

  recoverableError(error: RecoverableToolError): this {
    this.schema.recoverableErrors = [...(this.schema.recoverableErrors ?? []), error];
    return this;
  }

  parameters(parameters: ToolSchema['parameters']): this {
    this.schema.parameters = parameters;
    return this;
  }

  example(description: string, args: Record<string, JsonValue>, expectedOutput?: JsonValue): this {
    const example: ToolExample = { description, arguments: args, expectedOutput };
    this.schema.examples = [...(this.schema.examples ?? []), example];
    return this;
  }

  dangerous(): this {
    this.schema.dangerous = true;
    return this;
  }

  tags(tags: string[]): this {
    this.schema.tags = tags;
    return this;
  }

  category(category: string): this {
    this.schema.category = category;
    return this;
  }

  timeoutMs(timeoutMs: number): this {
    this.timeoutMsValue = timeoutMs;
    return this;
  }

  retryPolicy(retryPolicy: ToolDefinition['retryPolicy']): this {
    this.retryPolicyValue = retryPolicy;
    return this;
  }

  critical(value = true): this {
    this.criticalValue = value;
    return this;
  }

  handler(fn: ToolFunction): this {
    this.executeFn = fn;
    return this;
  }

  onRollback(fn: ToolDefinition['rollback']): this {
    this.rollbackFn = fn;
    return this;
  }

  build(): ToolDefinition {
    this.applyDefaults();
    this.validate();

    if (!this.executeFn) {
      throw new Error('Tool needs a handler');
    }

    return {
      schema: this.schema as ToolSchema,
      execute: this.executeFn,
      rollback: this.rollbackFn,
      timeoutMs: this.timeoutMsValue,
      retryPolicy: this.retryPolicyValue,
      critical: this.criticalValue,
    };
  }

  private applyDefaults(): void {
    if (this.schema.description && !this.schema.summary) {
      this.schema.summary = this.schema.description.split('.').at(0) ?? this.schema.description;
    }

    if (this.schema.description && !this.schema.whenToUse) {
      this.schema.whenToUse = this.schema.description;
    }

    if (!this.schema.whenNotToUse) {
      this.schema.whenNotToUse = 'Do not use when the required arguments are unknown or the action is outside the task scope.';
    }

    if (!this.schema.expectedOutput) {
      this.schema.expectedOutput = 'A JSON-serializable result describing the outcome.';
    }
  }

  private validate(): void {
    if (!this.schema.name || !this.schema.description || !this.schema.parameters) {
      throw new Error('Incomplete tool: name, description and parameters are required');
    }

    if (!/^[a-z][a-z0-9_]{2,63}$/.test(this.schema.name)) {
      throw new Error(`Invalid tool name "${this.schema.name}". Use snake_case with 3-64 characters.`);
    }

    if (this.schema.description.trim().length < 12) {
      throw new Error(`Tool "${this.schema.name}" needs a more descriptive description`);
    }

    if (this.schema.summary && this.schema.summary.trim().length < 6) {
      throw new Error(`Tool "${this.schema.name}" needs a useful summary`);
    }

    if (this.schema.dangerous && (!this.schema.examples || this.schema.examples.length === 0)) {
      throw new Error(`Dangerous tool "${this.schema.name}" must provide at least one example`);
    }

    if (this.schema.parameters.type !== 'object') {
      throw new Error(`Tool "${this.schema.name}" parameters must be an object schema`);
    }
  }
}

export function createTool(): ToolBuilder {
  return new ToolBuilder();
}
