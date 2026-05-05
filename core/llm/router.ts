import {
  AgentMessage,
  LLMConfig,
  LLMResponse,
  LLMProvider,
  LLMProviderRequest,
  LLMProviderResponse,
  LLMRouterPolicy,
  LLMTaskKind,
  ToolSchema,
} from '../types/index.js';
import { LLMAdapter } from './adapter.js';
import { redactMessages } from './redaction.js';

export class LLMRouter {
  private readonly providers = new Map<string, LLMProvider>();
  private activeCalls = 0;
  private readonly queue: Array<() => void> = [];

  constructor(
    providers: LLMProvider[],
    private readonly policy: LLMRouterPolicy
  ) {
    for (const provider of providers) {
      this.providers.set(provider.name, provider);
    }
  }

  private async acquireSlot(): Promise<void> {
    const maxConcurrent = this.policy.maxConcurrentCalls ?? 3;
    
    if (this.activeCalls < maxConcurrent) {
      this.activeCalls++;
      return;
    }

    // Queue up
    return new Promise(resolve => {
      this.queue.push(() => {
        this.activeCalls++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.activeCalls--;
    const next = this.queue.shift();
    if (next) next();
  }

  async complete(input: {
    messages: AgentMessage[];
    taskKind?: LLMTaskKind;
    config?: Partial<LLMConfig>;
    tools?: ToolSchema[];
  }): Promise<LLMProviderResponse> {
    const taskKind = input.taskKind ?? 'general';
    const orderedProviders = this.providerOrder(taskKind);
    const errors: string[] = [];

    for (const provider of orderedProviders) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.policy.timeoutMs);

      try {
        // Rate limit: wait for a concurrency slot
        await this.acquireSlot();

        const model = input.config?.model ?? this.policy.taskModelPreferences[taskKind] ?? provider.defaultModel;
        const request: LLMProviderRequest = {
          messages: redactMessages(input.messages),
          config: { ...input.config, model },
          taskKind,
          tools: provider.capabilities.nativeToolCalling ? input.tools : undefined,
          signal: controller.signal,
        };
        const response = await provider.complete(request);
        this.releaseSlot();

        if (
          this.policy.maxEstimatedCostUsd !== undefined &&
          response.estimatedCostUsd > this.policy.maxEstimatedCostUsd
        ) {
          throw new Error(
            `estimated cost ${response.estimatedCostUsd.toFixed(6)} exceeds budget ${this.policy.maxEstimatedCostUsd}`
          );
        }

        return response;
      } catch (error) {
        this.releaseSlot();
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${provider.name}: ${message}`);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(`All LLM providers failed. ${errors.join(' | ')}`);
  }

  async *stream(input: {
    messages: AgentMessage[];
    taskKind?: LLMTaskKind;
    config?: Partial<LLMConfig>;
    tools?: ToolSchema[];
    onStream?: (chunk: string) => void;
  }): AsyncIterable<string> {
    const taskKind = input.taskKind ?? 'general';
    const orderedProviders = this.providerOrder(taskKind);

    for (const provider of orderedProviders) {
      if (!provider.stream || !provider.capabilities.streaming) continue;

      try {
        const model = input.config?.model ?? this.policy.taskModelPreferences[taskKind] ?? provider.defaultModel;
        const request: LLMProviderRequest = {
          messages: redactMessages(input.messages),
          config: { ...input.config, model },
          taskKind,
          tools: provider.capabilities.nativeToolCalling ? input.tools : undefined,
          onStream: input.onStream,
        };

        for await (const chunk of provider.stream(request)) {
          yield chunk;
        }
        return; // Sucesso no primeiro provedor que suporta streaming
      } catch (error) {
        // Fallback para o próximo provedor
      }
    }

    // Se nenhum streaming funcionar, podemos cair para complete() ou falhar
    throw new Error('Streaming failed on all available providers');
  }

  private providerOrder(taskKind: LLMTaskKind): LLMProvider[] {
    const preferredModelProvider = this.providerForModel(this.policy.taskModelPreferences[taskKind]);
    const names = [
      preferredModelProvider,
      this.policy.primaryProvider,
      ...this.policy.fallbackProviders,
    ].filter((name): name is string => Boolean(name));

    const uniqueNames = Array.from(new Set(names));
    const providers = uniqueNames
      .map((name) => this.providers.get(name))
      .filter((provider): provider is LLMProvider => Boolean(provider));

    if (providers.length === 0) {
      throw new Error('No configured LLM provider is available');
    }

    return providers;
  }

  private providerForModel(model: string | undefined): string | undefined {
    if (!model) {
      return undefined;
    }

    if (model.startsWith('openai/')) {
      return 'openrouter';
    }

    if (model.startsWith('claude')) {
      return 'anthropic';
    }

    if (model.startsWith('gpt')) {
      return 'openai';
    }

    return undefined;
  }
}

export class RouterLLMAdapter implements LLMAdapter {
  constructor(
    private readonly router: LLMRouter,
    private readonly taskKind: LLMTaskKind = 'general',
    private readonly tools?: ToolSchema[]
  ) {}

  async complete(messages: AgentMessage[], config?: Partial<LLMConfig>): Promise<LLMResponse> {
    return this.router.complete({
      messages,
      config,
      taskKind: this.taskKind,
      tools: this.tools,
    });
  }

  async *stream(messages: AgentMessage[], config?: Partial<LLMConfig>, onStream?: (chunk: string) => void): AsyncIterable<string> {
    yield* this.router.stream({
      messages,
      config,
      taskKind: this.taskKind,
      tools: this.tools,
      onStream,
    });
  }
}
