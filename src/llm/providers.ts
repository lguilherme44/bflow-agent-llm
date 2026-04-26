import { AgentMessage, LLMConfig, LLMResponse, LLMProvider, LLMProviderRequest, LLMProviderResponse } from '../types/index.js';
import { LLMResponseParser } from './adapter.js';
import { redactMessages } from './redaction.js';

export interface ProviderPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export interface HttpProviderConfig {
  name: string;
  apiKey?: string;
  baseUrl: string;
  defaultModel: string;
  pricing?: ProviderPricing;
}

abstract class BaseHttpProvider implements LLMProvider {
  readonly name: string;
  readonly defaultModel: string;

  constructor(protected readonly config: HttpProviderConfig) {
    this.name = config.name;
    this.defaultModel = config.defaultModel;
  }

  abstract readonly capabilities: LLMProvider['capabilities'];

  async *stream(request: LLMProviderRequest): AsyncIterable<string> {
    const model = request.config?.model ?? this.defaultModel;
    const body = {
      ...this.body(request, model),
      stream: true,
    };

    const response = await fetch(this.endpoint(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.name} provider streaming failed: ${response.status} ${text}`);
    }

    if (!response.body) {
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          
          const data = trimmed.slice(6);
          if (data === '[DONE]') break;

          try {
            const chunk = JSON.parse(data);
            const content = this.extractStreamContent(chunk);
            if (content) {
              yield content;
              request.onStream?.(content);
            }
          } catch (e) {
            // Ignorar erros de parse parciais
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  protected abstract extractStreamContent(payload: Record<string, unknown>): string | undefined;

  async complete(request: LLMProviderRequest): Promise<LLMProviderResponse> {
    const startedAt = Date.now();
    const model = request.config?.model ?? this.defaultModel;
    const response = await fetch(this.endpoint(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(request, model)),
      signal: request.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.name} provider failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const content = this.extractContent(payload);
    const usage = this.extractUsage(payload);
    const finishReason = this.extractFinishReason(payload);
    const parsed = LLMResponseParser.parse(content);
    const latencyMs = Date.now() - startedAt;

    return {
      content: parsed.thought,
      toolCalls: parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined,
      finalResponse: parsed.finalResponse,
      parseError: parsed.parseError,
      finishReason,
      usage,
      provider: this.name,
      model,
      latencyMs,
      estimatedCostUsd: this.estimateCost(usage.promptTokens, usage.completionTokens),
    };
  }

  protected abstract body(request: LLMProviderRequest, model: string): Record<string, unknown>;
  protected abstract extractContent(payload: Record<string, unknown>): string;
  protected abstract extractUsage(payload: Record<string, unknown>): LLMProviderResponse['usage'];
  protected abstract extractFinishReason(payload: Record<string, unknown>): LLMResponse['finishReason'];

  protected endpoint(): string {
    return this.config.baseUrl;
  }

  protected headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey ?? ''}`,
      'Content-Type': 'application/json',
    };
  }

  protected normalizeMessages(messages: AgentMessage[]): Array<Record<string, string>> {
    return redactMessages(messages).map((message) => ({
      role: message.role === 'tool' ? 'user' : message.role,
      content: message.content,
    }));
  }

  protected estimateCost(promptTokens: number, completionTokens: number): number {
    const pricing = this.config.pricing;
    if (!pricing) {
      return 0;
    }

    return (promptTokens / 1_000_000) * pricing.inputPerMillionUsd + (completionTokens / 1_000_000) * pricing.outputPerMillionUsd;
  }
}

export class OpenAIProvider extends BaseHttpProvider {
  readonly capabilities = {
    streaming: true,
    nativeToolCalling: true,
    jsonMode: true,
  };

  constructor(config?: Partial<HttpProviderConfig>) {
    super({
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1/chat/completions',
      defaultModel: 'gpt-5.4-mini',
      ...config,
    });
  }

  protected body(request: LLMProviderRequest, model: string): Record<string, unknown> {
    return {
      model,
      temperature: request.config?.temperature ?? 0.2,
      max_tokens: request.config?.maxTokens,
      response_format: this.capabilities.jsonMode ? { type: 'json_object' } : undefined,
      messages: this.normalizeMessages(request.messages),
      tools: request.tools?.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      stream_options: request.config?.model?.includes('gpt') ? { include_usage: true } : undefined,
    };
  }

  protected extractContent(payload: Record<string, unknown>): string {
    const choices = payload.choices;
    if (!Array.isArray(choices)) {
      return '';
    }
    const first = choices[0] as { message?: { content?: string } };
    return first.message?.content ?? '';
  }

  protected extractFinishReason(payload: Record<string, unknown>): LLMResponse['finishReason'] {
    const choices = payload.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return undefined;
    }
    const reason = (choices[0] as { finish_reason?: string }).finish_reason;
    if (reason === 'stop' || reason === 'length' || reason === 'content_filter' || reason === 'tool_calls') {
      return reason;
    }
    return 'other';
  }

  protected extractUsage(payload: Record<string, unknown>): LLMProviderResponse['usage'] {
    const usage = payload.usage as { 
      prompt_tokens?: number; 
      completion_tokens?: number; 
      total_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number }
    } | undefined;
    return {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens
    };
  }

  protected extractStreamContent(payload: Record<string, unknown>): string | undefined {
    const choices = payload.choices;
    if (!Array.isArray(choices) || choices.length === 0) return undefined;
    const delta = (choices[0] as { delta?: { content?: string } }).delta;
    return delta?.content;
  }
}

export class AnthropicProvider extends BaseHttpProvider {
  readonly capabilities = {
    streaming: true,
    nativeToolCalling: true,
    jsonMode: false,
  };

  constructor(config?: Partial<HttpProviderConfig>) {
    super({
      name: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1/messages',
      defaultModel: 'claude-sonnet-4-5',
      ...config,
    });
  }

  protected override headers(): Record<string, string> {
    return {
      'x-api-key': this.config.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };
  }

  protected body(request: LLMProviderRequest, model: string): Record<string, unknown> {
    return {
      model,
      max_tokens: request.config?.maxTokens ?? 2_048,
      temperature: request.config?.temperature ?? 0.2,
      messages: this.normalizeMessages(request.messages).filter((message) => message.role !== 'system'),
      system: request.messages.find((message) => message.role === 'system')?.content,
    };
  }

  protected extractContent(payload: Record<string, unknown>): string {
    const content = payload.content;
    if (!Array.isArray(content)) {
      return '';
    }
    return content
      .map((item) => (typeof item === 'object' && item !== null && 'text' in item ? String(item.text) : ''))
      .join('');
  }

  protected extractFinishReason(payload: Record<string, unknown>): LLMResponse['finishReason'] {
    const reason = payload.stop_reason as string | undefined;
    if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
    if (reason === 'max_tokens') return 'length';
    if (reason === 'tool_use') return 'tool_calls';
    return 'other';
  }

  protected extractUsage(payload: Record<string, unknown>): LLMProviderResponse['usage'] {
    const usage = payload.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    const promptTokens = usage?.input_tokens ?? 0;
    const completionTokens = usage?.output_tokens ?? 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  protected extractStreamContent(payload: Record<string, unknown>): string | undefined {
    if (payload.type === 'content_block_delta') {
      const delta = payload.delta as { text?: string };
      return delta?.text;
    }
    return undefined;
  }
}

export class OpenRouterProvider extends OpenAIProvider {
  constructor(config?: Partial<HttpProviderConfig>) {
    super({
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      defaultModel: 'openai/gpt-5.4-mini',
      ...config,
    });
  }
}

export class LMStudioProvider extends OpenAIProvider {
  constructor(config?: Partial<HttpProviderConfig>) {
    const defaults: HttpProviderConfig = {
      name: 'lmstudio',
      baseUrl: 'http://localhost:1234/v1/chat/completions',
      defaultModel: 'local-model',
    };
    
    super({
      ...defaults,
      ...Object.fromEntries(Object.entries(config ?? {}).filter(([_, v]) => v !== undefined))
    });
  }

  readonly capabilities = {
    streaming: true,
    nativeToolCalling: false, // Local models often perform better with tools in prompt
    jsonMode: false, // Avoid 400 errors in some local backends
  };

  protected headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      // LM Studio generally doesn't require an API key
      Authorization: `Bearer ${this.config.apiKey ?? 'lm-studio'}`,
    };
  }

  protected override endpoint(): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    if (base.endsWith('/chat/completions')) return base;
    if (base.endsWith('/v1')) return `${base}/chat/completions`;
    return `${base}/v1/chat/completions`;
  }
}


export class OllamaProvider extends OpenAIProvider {
  constructor(config?: Partial<HttpProviderConfig>) {
    const defaults: HttpProviderConfig = {
      name: 'ollama',
      baseUrl: 'http://localhost:11434',
      defaultModel: 'llama3',
    };

    super({
      ...defaults,
      ...Object.fromEntries(Object.entries(config ?? {}).filter(([_, v]) => v !== undefined))
    });
  }

  protected override endpoint(): string {
    const base = this.config.baseUrl.replace(/\/$/, '');
    if (base.endsWith('/api/chat')) return base;
    return `${base}/api/chat`;
  }

  protected override body(request: LLMProviderRequest, model: string): Record<string, unknown> {
    return {
      model,
      messages: this.normalizeMessages(request.messages),
      stream: false,
      options: {
        temperature: request.config?.temperature ?? 0.2,
        num_predict: request.config?.maxTokens,
      },
    };
  }

  protected override extractContent(payload: Record<string, unknown>): string {
    const message = payload.message as { content?: string } | undefined;
    return message?.content ?? '';
  }

  protected override extractUsage(payload: Record<string, unknown>): LLMProviderResponse['usage'] {
    const promptTokens = (payload.prompt_eval_count as number) ?? 0;
    const completionTokens = (payload.eval_count as number) ?? 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  protected override extractFinishReason(payload: Record<string, unknown>): LLMResponse['finishReason'] {
    return payload.done ? 'stop' : 'other';
  }

  readonly capabilities = {
    streaming: true,
    nativeToolCalling: false,
    jsonMode: false,
  };

  protected headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      // Ollama doesn't require an API key
      Authorization: `Bearer ollama`,
    };
  }
}

export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-model';
  readonly capabilities = {
    streaming: false,
    nativeToolCalling: false,
    jsonMode: true,
  };
  private readonly responses: string[];

  constructor(responses: string[]) {
    this.responses = [...responses];
  }

  async complete(request: LLMProviderRequest): Promise<LLMProviderResponse> {
    const startedAt = Date.now();
    const content = this.responses.shift() ?? JSON.stringify({ final: { status: 'success', summary: 'mock complete' } });
    const parsed = LLMResponseParser.parse(content);
    const promptTokens = request.messages.reduce((total, message) => total + Math.ceil(message.content.length / 4), 0);
    const completionTokens = Math.ceil(content.length / 4);

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
      provider: this.name,
      model: this.defaultModel,
      latencyMs: Date.now() - startedAt,
      estimatedCostUsd: 0,
    };
  }
}

export function providerFromEnv(name: 'openai' | 'anthropic' | 'openrouter' | 'lmstudio' | 'ollama'): LLMProvider {
  switch (name) {
    case 'openai':
      return new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
    case 'anthropic':
      return new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
    case 'openrouter':
      return new OpenRouterProvider({ apiKey: process.env.OPENROUTER_API_KEY });
    case 'lmstudio':
      return new LMStudioProvider();
    case 'ollama':
      return new OllamaProvider();
  }
}

export function defaultLLMConfig(model?: string): Partial<LLMConfig> {
  return {
    model,
    temperature: 0.2,
    maxTokens: 2_048,
  };
}
