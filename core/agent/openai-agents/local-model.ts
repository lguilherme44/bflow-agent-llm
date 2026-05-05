import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';

export interface LocalModelEvent {
  provider: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  requestMessages: number;
}

export interface LocalModelOptions {
  provider?: string;
  maxOutputTokens?: number;
  maxInputChars?: number;
  maxToolOutputChars?: number;
  temperature?: number;
  onModelEvent?: (event: LocalModelEvent) => void;
}

/**
 * OpenAI-compatible model adapter tuned for local coding models.
 *
 * Ollama, LM Studio and MLX OpenAI-compatible servers frequently return tool
 * calls as JSON inside message content. This adapter normalizes those calls
 * into the Agents SDK function_call shape and caps context/tool output to keep
 * 7B/8B models stable on low VRAM.
 */
export class LocalToolCallingModel {
  private readonly toolSchemas: Map<string, any> = new Map();

  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly options: LocalModelOptions = {}
  ) {}

  getRetryAdvice() {
    return undefined;
  }

  async getResponse(request: any): Promise<any> {
    const messages = this.trimMessagesToBudget(this.buildMessages(request));
    const tools = this.buildTools(request);

    if (tools) {
      for (const t of tools) {
        const fn = (t as any).function;
        if (fn) this.toolSchemas.set(fn.name, fn.parameters);
      }
    }

    const debug = process.env.AGENT_DEBUG === '1';
    if (debug) {
      console.error('[LocalModel] request', {
        model: this.model,
        messages: messages.length,
        tools: tools?.length ?? 0,
        maxInputChars: this.options.maxInputChars,
        maxToolOutputChars: this.options.maxToolOutputChars,
      });
    }

    const startedAt = Date.now();
    const completion = await this.client.chat.completions.create(
      {
        model: this.model,
        messages,
        tools: tools && tools.length > 0 ? tools : undefined,
        temperature: request.modelSettings?.temperature ?? this.options.temperature ?? 0.1,
        max_tokens: request.modelSettings?.maxTokens ?? this.options.maxOutputTokens ?? 1536,
      },
      request.signal ? { signal: request.signal } : undefined
    );

    this.options.onModelEvent?.({
      provider: this.options.provider ?? 'local',
      model: this.model,
      usage: {
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        totalTokens: completion.usage?.total_tokens ?? 0,
      },
      latencyMs: Date.now() - startedAt,
      requestMessages: messages.length,
    });

    const choice = completion.choices[0];
    if (!choice) return this.createEmptyResponse(completion);

    if (debug) {
      console.error('[LocalModel] response', {
        finishReason: choice.finish_reason,
        hasToolCalls: Boolean(choice.message.tool_calls?.length),
        contentPreview: String(choice.message.content ?? '').slice(0, 240),
      });
    }

    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      return this.convertNativeToolCalls(choice, completion);
    }

    const content = choice.message.content || '';
    const extractedCall = this.extractToolCallFromContent(content);
    if (extractedCall && this.toolSchemas.has(extractedCall.name)) {
      return this.convertExtractedToolCall(extractedCall, completion);
    }

    return this.convertTextResponse(content, completion);
  }

  async *getStreamedResponse(request: any): AsyncIterable<any> {
    yield { type: 'response_started' };
    const response = await this.getResponse(request);
    yield { type: 'response_done', response };
  }

  private convertNativeToolCalls(choice: any, completion: any) {
    const output: any[] = [];

    if (choice.message.content) {
      const cleaned = this.cleanSpecialTokens(choice.message.content);
      if (cleaned) {
        output.push({
          id: randomUUID(),
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: cleaned, annotations: [] }],
          status: 'completed',
        });
      }
    }

    for (const tc of choice.message.tool_calls) {
      const callId = tc.id || randomUUID();
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }

      output.push({
        id: callId,
        type: 'function_call',
        callId,
        name: tc.function.name,
        arguments: JSON.stringify(args),
        status: 'completed',
      });
    }

    return {
      output,
      usage: this.extractUsage(completion),
      responseId: completion.id,
    };
  }

  private convertExtractedToolCall(extracted: { name: string; arguments: Record<string, any> }, completion: any) {
    const callId = randomUUID();
    return {
      output: [
        {
          id: callId,
          type: 'function_call',
          callId,
          name: extracted.name,
          arguments: JSON.stringify(extracted.arguments),
          status: 'completed',
        },
      ],
      usage: this.extractUsage(completion),
      responseId: completion.id,
    };
  }

  private convertTextResponse(content: string, completion: any) {
    const cleaned = this.cleanSpecialTokens(content);
    return {
      output: [
        {
          id: randomUUID(),
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: cleaned || 'Sem resposta.', annotations: [] }],
          status: 'completed',
        },
      ],
      usage: this.extractUsage(completion),
      responseId: completion.id,
    };
  }

  private createEmptyResponse(completion: any) {
    return {
      output: [
        {
          id: randomUUID(),
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Sem resposta do modelo.', annotations: [] }],
          status: 'completed',
        },
      ],
      usage: this.extractUsage(completion),
      responseId: completion.id,
    };
  }

  private extractToolCallFromContent(content: string): { name: string; arguments: Record<string, any> } | null {
    if (!content || content.trim().length === 0) return null;

    const cleaned = this.cleanSpecialTokens(content);
    const jsonStr = this.extractJson(cleaned);
    if (!jsonStr) return null;

    try {
      const parsed = JSON.parse(jsonStr);
      return this.normalizeToolCallJson(parsed);
    } catch {
      return null;
    }
  }

  private normalizeToolCallJson(parsed: any): { name: string; arguments: Record<string, any> } | null {
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const normalized = this.normalizeToolCallJson(item);
        if (normalized) return normalized;
      }
      return null;
    }

    if (!parsed || typeof parsed !== 'object') return null;

    if (Array.isArray(parsed.tool_calls)) {
      return this.normalizeToolCallJson(parsed.tool_calls);
    }

    const functionPayload = parsed.function && typeof parsed.function === 'object' ? parsed.function : undefined;
    const directName = parsed.name ?? parsed.tool ?? functionPayload?.name;
    if (typeof directName === 'string' && this.toolSchemas.has(directName)) {
      const args = parsed.arguments ?? parsed.parameters ?? functionPayload?.arguments ?? {};
      return {
        name: directName,
        arguments: this.normalizeArguments(args),
      };
    }

    for (const key of Object.keys(parsed)) {
      if (this.toolSchemas.has(key) && typeof parsed[key] === 'object') {
        return { name: key, arguments: this.normalizeArguments(parsed[key]) };
      }
    }

    return null;
  }

  private normalizeArguments(args: unknown): Record<string, any> {
    if (!args) return {};
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args);
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }
    return typeof args === 'object' ? args as Record<string, any> : {};
  }

  private extractJson(text: string): string | null {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]?.trim()) return fenced[1].trim();

    const trimmed = text.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      return trimmed;
    }

    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return text.slice(objectStart, objectEnd + 1);
    }

    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return text.slice(arrayStart, arrayEnd + 1);
    }

    return null;
  }

  private cleanSpecialTokens(text: string): string {
    return text
      .replace(/<\|[a-z_]+\|>/gi, '')
      .replace(/<\/?(think|tool_call)>/gi, '')
      .replace(/```json\s*```/g, '')
      .replace(/```\s*```/g, '')
      .trim();
  }

  private extractUsage(completion: any) {
    const u = completion.usage;
    return {
      requests: 1,
      inputTokens: u?.prompt_tokens ?? 0,
      outputTokens: u?.completion_tokens ?? 0,
      totalTokens: u?.total_tokens ?? 0,
    };
  }

  private buildMessages(request: any): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    if (request.systemInstructions) {
      messages.push({ role: 'system', content: request.systemInstructions });
    }

    if (!request.input) return messages;

    if (typeof request.input === 'string') {
      messages.push({ role: 'user', content: request.input });
      return messages;
    }

    if (!Array.isArray(request.input)) return messages;

    for (const item of request.input) {
      if (item.type === 'message' && item.role) {
        const textContent = this.extractMessageText(item.content);
        if (textContent) {
          messages.push({
            role: item.role === 'user' ? 'user' : 'assistant',
            content: textContent,
          });
        }
      } else if (item.type === 'function_call') {
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: item.callId || item.id,
              type: 'function' as const,
              function: { name: item.name, arguments: item.arguments || '{}' },
            },
          ],
        });
      } else if (item.type === 'function_call_output' || item.type === 'function_call_result') {
        messages.push({
          role: 'tool',
          tool_call_id: item.callId || item.id,
          content: this.truncateToolOutput(this.extractToolOutputText(item.output)),
        });
      }
    }

    return messages;
  }

  private extractMessageText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .filter((c: any) => c.type === 'input_text' || c.type === 'output_text' || c.type === 'text')
      .map((c: any) => c.text || c.value || '')
      .join('\n');
  }

  private extractToolOutputText(output: unknown): string {
    if (typeof output === 'string') return output;
    if (output && typeof output === 'object') {
      if ((output as any).type === 'text' && (output as any).text) {
        return (output as any).text;
      }
      return JSON.stringify(output);
    }
    return '{}';
  }

  private truncateToolOutput(outputText: string): string {
    const maxChars = this.options.maxToolOutputChars ?? 3000;
    if (outputText.length <= maxChars) return outputText || '{}';
    return `${outputText.slice(0, maxChars)}\n\n[... truncated. Use line ranges, filters or narrower searches for more.]`;
  }

  private trimMessagesToBudget(messages: OpenAI.ChatCompletionMessageParam[]): OpenAI.ChatCompletionMessageParam[] {
    const maxChars = this.options.maxInputChars;
    if (!maxChars || maxChars <= 0) return messages;

    let total = this.countMessageChars(messages);
    if (total <= maxChars) return messages;

    const systemMessages = messages.filter((message) => message.role === 'system');
    const conversation = messages.filter((message) => message.role !== 'system');
    let omitted = 0;

    while (conversation.length > 1 && total > maxChars) {
      const removed = conversation.shift();
      if (!removed) break;
      omitted += 1;
      total -= this.countMessageChars([removed]);
    }

    while (conversation[0]?.role === 'tool') {
      const removed = conversation.shift();
      if (!removed) break;
      omitted += 1;
    }

    const budgetNotice: OpenAI.ChatCompletionMessageParam[] = omitted > 0
      ? [{
          role: 'system',
          content: `Local context budget active: ${omitted} older message(s) were omitted. Re-read files with tools when needed.`,
        }]
      : [];

    return [...systemMessages, ...budgetNotice, ...conversation];
  }

  private countMessageChars(messages: OpenAI.ChatCompletionMessageParam[]): number {
    return messages.reduce((total, message) => total + this.messageToText(message).length + 64, 0);
  }

  private messageToText(message: OpenAI.ChatCompletionMessageParam): string {
    const content = (message as any).content;
    if (typeof content === 'string') return content;
    if (content === null || content === undefined) return JSON.stringify(message);
    return JSON.stringify(content);
  }

  private buildTools(request: any): OpenAI.ChatCompletionTool[] | undefined {
    if (!request.tools || request.tools.length === 0) return undefined;

    return request.tools
      .filter((t: any) => t.type === 'function')
      .map((t: any) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.parameters || { type: 'object', properties: {} },
        },
      }));
  }
}
