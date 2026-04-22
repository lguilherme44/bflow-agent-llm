import { randomUUID } from 'node:crypto';
import { AgentMessage, JsonValue, LLMConfig, LLMFinalResponse, LLMResponse, ToolCall } from '../types';
import { estimateTokensFromText, toJsonValue } from '../utils/json';

export interface LLMAdapter {
  complete(messages: AgentMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse>;
}

export interface ParsedLLMContent {
  thought: string;
  toolCalls: ToolCall[];
  finalResponse?: LLMFinalResponse;
  parseError?: string;
}

export class LLMResponseParser {
  static parse(content: string): ParsedLLMContent {
    const jsonText = this.extractJson(content);
    if (!jsonText) {
      return { thought: content, toolCalls: [] };
    }

    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const toolCalls = this.parseToolCallList(parsed);
      const finalResponse = this.parseFinal(parsed);
      const thought = typeof parsed.thought === 'string' ? parsed.thought : content;
      return { thought, toolCalls, finalResponse };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        thought: content,
        toolCalls: [],
        parseError: `Invalid JSON response: ${message}`,
      };
    }
  }

  static parseToolCalls(content: string): { thought: string; toolCalls: ToolCall[] } {
    const parsed = this.parse(content);
    return { thought: parsed.thought, toolCalls: parsed.toolCalls };
  }

  private static extractJson(content: string): string | null {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      return fenced[1];
    }

    const trimmed = content.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      return trimmed;
    }

    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return trimmed.slice(objectStart, objectEnd + 1);
    }

    return null;
  }

  private static parseToolCallList(parsed: Record<string, unknown>): ToolCall[] {
    if (typeof parsed.tool === 'string') {
      return [this.createToolCall(parsed.tool, parsed.arguments)];
    }

    const rawCalls = parsed.toolCalls ?? parsed.tools;
    if (!Array.isArray(rawCalls)) {
      return [];
    }

    return rawCalls
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map((item) => {
        const name = typeof item.tool === 'string' ? item.tool : String(item.toolName ?? '');
        return this.createToolCall(name, item.arguments);
      })
      .filter((call) => call.toolName.length > 0);
  }

  private static createToolCall(toolName: string, rawArguments: unknown): ToolCall {
    const jsonArguments = toJsonValue(rawArguments);
    const args = isJsonObject(jsonArguments) ? jsonArguments : {};
    return {
      id: randomUUID(),
      toolName,
      arguments: args,
      timestamp: new Date().toISOString(),
    };
  }

  private static parseFinal(parsed: Record<string, unknown>): LLMFinalResponse | undefined {
    const rawFinal = parsed.final;
    if (!isRecord(rawFinal)) {
      return undefined;
    }

    const status = rawFinal.status === 'failure' || rawFinal.status === 'needs_human' ? rawFinal.status : 'success';
    const summary = typeof rawFinal.summary === 'string' ? rawFinal.summary : 'Task finished.';
    return { status, summary };
  }
}

export class MockLLMAdapter implements LLMAdapter {
  private readonly responses = new Map<string, string[]>();
  private readonly defaultResponses: string[] = [];

  setResponse(taskPattern: string, response: string): void {
    this.responses.set(taskPattern, [response]);
  }

  setResponses(taskPattern: string, responses: string[]): void {
    this.responses.set(taskPattern, [...responses]);
  }

  pushDefaultResponse(response: string): void {
    this.defaultResponses.push(response);
  }

  async complete(messages: AgentMessage[]): Promise<LLMResponse> {
    const content = this.pickResponse(messages);
    const parsed = LLMResponseParser.parse(content);
    const promptTokens = this.estimateMessages(messages);
    const completionTokens = estimateTokensFromText(content);

    return {
      content: parsed.thought,
      toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
      finalResponse: parsed.finalResponse,
      parseError: parsed.parseError,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }

  private pickResponse(messages: AgentMessage[]): string {
    const lastUserMessage = messages.filter((message) => message.role === 'user').at(-1);
    if (lastUserMessage) {
      for (const [pattern, responses] of this.responses.entries()) {
        if (lastUserMessage.content.includes(pattern) && responses.length > 0) {
          return responses.shift() as string;
        }
      }
    }

    const defaultResponse = this.defaultResponses.shift();
    if (defaultResponse) {
      return defaultResponse;
    }

    const lastToolMessage = messages.filter((message) => message.role === 'tool').at(-1);
    if (lastToolMessage?.toolResult?.success) {
      return JSON.stringify({
        final: {
          status: 'success',
          summary: 'The requested task completed successfully.',
        },
      });
    }

    return JSON.stringify({
      thought: 'I should inspect the project before acting.',
      tool: 'read_file',
      arguments: { filepath: './src/index.ts' },
    });
  }

  private estimateMessages(messages: AgentMessage[]): number {
    return messages.reduce((total, message) => total + estimateTokensFromText(message.content), 0);
  }
}

export class OpenAIAdapter implements LLMAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.openai.com/v1'
  ) {}

  async complete(messages: AgentMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config?.model ?? 'gpt-5.4-mini',
        temperature: config?.temperature ?? 0.2,
        max_tokens: config?.maxTokens,
        messages: messages.map((message) => ({
          role: message.role === 'tool' ? 'user' : message.role,
          content: message.content,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content ?? '';
    const parsed = LLMResponseParser.parse(content);

    return {
      content: parsed.thought,
      toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
      finalResponse: parsed.finalResponse,
      parseError: parsed.parseError,
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.completion_tokens ?? 0,
        totalTokens: payload.usage?.total_tokens ?? 0,
      },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
