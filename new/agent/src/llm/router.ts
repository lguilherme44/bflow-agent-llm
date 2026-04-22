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
} from '../types';
import { LLMAdapter } from './adapter';
import { redactMessages } from './redaction';

export class LLMRouter {
  private readonly providers = new Map<string, LLMProvider>();

  constructor(
    providers: LLMProvider[],
    private readonly policy: LLMRouterPolicy
  ) {
    for (const provider of providers) {
      this.providers.set(provider.name, provider);
    }
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
        const model = input.config?.model ?? this.policy.taskModelPreferences[taskKind] ?? provider.defaultModel;
        const request: LLMProviderRequest = {
          messages: redactMessages(input.messages),
          config: { ...input.config, model },
          taskKind,
          tools: provider.capabilities.nativeToolCalling ? input.tools : undefined,
          signal: controller.signal,
        };
        const response = await provider.complete(request);

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
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${provider.name}: ${message}`);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(`All LLM providers failed. ${errors.join(' | ')}`);
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
}
