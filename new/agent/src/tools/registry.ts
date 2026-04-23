import { ToolDefinition, ToolSchema } from '../types/index.js';

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.schema.name)) {
      throw new Error(`Tool "${tool.schema.name}" is already registered`);
    }
    this.tools.set(tool.schema.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getSchemas(): ToolSchema[] {
    return this.list().map((tool) => tool.schema);
  }

  generateToolPrompt(): string {
    const sections: string[] = [
      'Available tools are listed below. Use them only when they move the current task forward.',
      'Respond with JSON. You may return a single tool call, multiple tool calls, or a final response.',
    ];

    for (const tool of this.list()) {
      sections.push(this.describeTool(tool.schema));
    }

    sections.push(
      [
        'Tool call formats:',
        '```json',
        JSON.stringify(
          {
            thought: 'Brief private-to-agent summary of the next action.',
            tool: 'tool_name',
            arguments: { key: 'value' },
          },
          null,
          2
        ),
        '```',
        '```json',
        JSON.stringify(
          {
            thought: 'Brief private-to-agent summary of the next actions.',
            toolCalls: [
              { tool: 'first_tool', arguments: { key: 'value' } },
              { tool: 'second_tool', arguments: { key: 'value' } },
            ],
          },
          null,
          2
        ),
        '```',
        '```json',
        JSON.stringify(
          {
            final: {
              status: 'success',
              summary: 'What was completed.',
            },
          },
          null,
          2
        ),
        '```',
      ].join('\n')
    );

    return sections.join('\n\n');
  }

  private describeTool(schema: ToolSchema): string {
    const lines: string[] = [
      `## ${schema.name}`,
      schema.summary,
      `Description: ${schema.description}`,
      `When to use: ${schema.whenToUse}`,
      `When not to use: ${schema.whenNotToUse ?? 'When it does not match the task.'}`,
      `Expected output: ${schema.expectedOutput}`,
    ];

    if (schema.dangerous) {
      lines.push('Requires human approval: yes');
    }

    if (schema.tags?.length) {
      lines.push(`Tags: ${schema.tags.join(', ')}`);
    }

    if (schema.failureModes.length > 0) {
      lines.push(`Failure modes: ${schema.failureModes.join('; ')}`);
    }

    if (schema.recoverableErrors.length > 0) {
      lines.push('Recoverable errors:');
      for (const error of schema.recoverableErrors) {
        lines.push(`- ${error.code}: ${error.message} Correction: ${error.correctionHint}`);
      }
    }

    lines.push('Parameters JSON Schema:');
    lines.push('```json');
    lines.push(JSON.stringify(schema.parameters, null, 2));
    lines.push('```');

    if (schema.examples.length > 0) {
      lines.push('Examples:');
      for (const example of schema.examples) {
        lines.push(`- ${example.description}: ${JSON.stringify(example.arguments)}`);
      }
    }

    return lines.join('\n');
  }
}
