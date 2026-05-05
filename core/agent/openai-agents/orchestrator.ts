import OpenAI from 'openai';
import {
  Runner,
  setTracingDisabled,
  extractAllTextOutput,
} from '@openai/agents';
import type { ModelProvider, InputGuardrail, OutputGuardrail } from '@openai/agents';
import { LocalToolCallingModel } from './local-model.js';
import type { LocalModelEvent } from './local-model.js';
import { createSwarmAgents } from './agents.js';
import { resolveLocalRuntimeProfile } from './runtime-profile.js';
import type { LocalRuntimeProfileId } from './runtime-profile.js';
import type { OpenAIToolRuntimeEvent } from '../../utils/file-utils.js';

setTracingDisabled(true);

export interface OpenAIAgentConfig {
  workspaceRoot: string;
  provider?: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  runtimeProfile?: LocalRuntimeProfileId | string;
  maxTurns?: number;
  maxOutputTokens?: number;
  maxInputChars?: number;
  maxToolOutputChars?: number;
  maxFileLines?: number;
  maxListFiles?: number;
  maxSearchMatches?: number;
  maxRagResults?: number;
  temperature?: number;
  signal?: AbortSignal;
  onUpdate?: (update: { role: string; content: string }) => void;
  onEvent?: (event: OpenAIAgentEvent) => void;
}

export interface OpenAIAgentEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'error' | 'complete' | 'llm';
  content: string;
  metadata?: Record<string, unknown>;
}

const validateInputGuardrail: InputGuardrail = {
  name: 'validate_input',
  execute: async ({ input }) => {
    if (Array.isArray(input)) {
      return { tripwireTriggered: false, outputInfo: 'OK' };
    }
    const text = typeof input === 'string' ? input.trim() : '';
    if (!text) {
      return { tripwireTriggered: true, outputInfo: 'Tarefa vazia. Descreva o que deseja fazer.' };
    }
    return { tripwireTriggered: false, outputInfo: 'OK' };
  },
};

const cleanupOutputGuardrail: OutputGuardrail = {
  name: 'cleanup_output',
  execute: async () => {
    return { tripwireTriggered: false, outputInfo: 'Checked' };
  },
};

function createLocalModelProvider(
  client: OpenAI,
  defaultModel: string,
  config: OpenAIAgentConfig,
  onModelEvent: (event: LocalModelEvent) => void
): ModelProvider {
  return {
    getModel(_modelName?: string) {
      const model = _modelName || defaultModel;
      return new LocalToolCallingModel(client, model, {
        provider: config.provider,
        maxOutputTokens: config.maxOutputTokens,
        maxInputChars: config.maxInputChars,
        maxToolOutputChars: config.maxToolOutputChars,
        temperature: config.temperature,
        onModelEvent,
      }) as any;
    },
  };
}

export async function runOpenAIAgent(task: string, config: OpenAIAgentConfig) {
  const profile = resolveLocalRuntimeProfile({
    provider: config.provider,
    model: config.model,
    runtimeProfile: config.runtimeProfile,
    maxTurns: config.maxTurns,
    maxOutputTokens: config.maxOutputTokens,
    maxInputChars: config.maxInputChars,
    maxToolOutputChars: config.maxToolOutputChars,
    maxFileLines: config.maxFileLines,
    maxListFiles: config.maxListFiles,
    maxSearchMatches: config.maxSearchMatches,
    maxRagResults: config.maxRagResults,
    temperature: config.temperature,
  });

  const emit = (event: OpenAIAgentEvent) => {
    config.onEvent?.(event);
    if (event.type === 'thinking') {
      config.onUpdate?.({ role: 'system', content: event.content });
    } else if (event.type === 'message') {
      config.onUpdate?.({ role: 'assistant', content: event.content });
    } else if (event.type === 'error') {
      config.onUpdate?.({ role: 'error', content: event.content });
    }
  };

  const onToolEvent = (event: OpenAIToolRuntimeEvent) => {
    emit({
      type: event.type,
      content: JSON.stringify({
        tool: event.tool,
        arguments: event.args,
        result: event.result,
        success: event.success,
        durationMs: event.durationMs,
      }),
      metadata: {
        tool: event.tool,
        success: event.success,
        durationMs: event.durationMs,
      },
    });
  };

  const client = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey || 'lm-studio',
  });

  const modelProvider = createLocalModelProvider(client, config.model, {
    ...config,
    maxOutputTokens: profile.maxOutputTokens,
    maxInputChars: profile.maxInputChars,
    maxToolOutputChars: profile.maxToolOutputChars,
    temperature: profile.temperature,
  }, (event) => {
    emit({
      type: 'llm',
      content: `${event.model}: ${event.usage.totalTokens} tokens`,
      metadata: {
        provider: event.provider,
        model: event.model,
        usage: event.usage,
        latencyMs: event.latencyMs,
        requestMessages: event.requestMessages,
      },
    });
  });

  const { plannerAgent } = createSwarmAgents(config.workspaceRoot, {
    runtimeProfile: profile,
    onToolEvent,
  });

  const runner = new Runner({
    modelProvider,
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
    inputGuardrails: [validateInputGuardrail],
    outputGuardrails: [cleanupOutputGuardrail],
    modelSettings: {
      temperature: profile.temperature,
      maxTokens: profile.maxOutputTokens,
      parallelToolCalls: false,
      truncation: 'auto',
      text: { verbosity: 'low' },
    },
  });

  emit({
    type: 'thinking',
    content: `Modelo: ${config.model} | Perfil: ${profile.label} | MaxTurns: ${profile.maxTurns}`,
    metadata: { runtimeProfile: profile.id, maxTurns: profile.maxTurns },
  });

  let result;
  try {
    result = await runner.run(plannerAgent, task, {
      maxTurns: profile.maxTurns,
      signal: config.signal,
    });
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    emit({ type: 'error', content: `Erro na execucao: ${errorMessage}` });
    throw error;
  }

  const content = extractFinalContent(result);
  emit({ type: 'message', content });
  return result;
}

function extractFinalContent(result: any): string {
  const cleanupOutput = (text: string): string =>
    text
      .replace(/<\|[a-z_]+\|>/gi, '')
      .replace(/<\/?(think|tool_call)>/gi, '')
      .replace(/```json\s*```/g, '')
      .replace(/```\s*```/g, '')
      .trim();

  try {
    const finalOutput = result.finalOutput;
    if (typeof finalOutput === 'string') return cleanupOutput(finalOutput);
    if (finalOutput) return cleanupOutput(JSON.stringify(finalOutput, null, 2));
  } catch {
    // Keep fallback path.
  }

  try {
    const allText = extractAllTextOutput(result.newItems);
    if (allText) return cleanupOutput(allText);
  } catch {
    // Keep fallback path.
  }

  const items = result.newItems || [];
  const toolOutputs = items.filter((item: any) =>
    item.type === 'tool_call_output_item' ||
    item.type === 'tool_call_item'
  );

  if (toolOutputs.length > 0) {
    return `Executou ${toolOutputs.length} operacoes com ferramentas.`;
  }
  return 'Finalizado sem conteudo retornado.';
}
