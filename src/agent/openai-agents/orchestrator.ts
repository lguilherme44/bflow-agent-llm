import OpenAI from 'openai';
import {
  Runner,
  setTracingDisabled,
  extractAllTextOutput,
} from '@openai/agents';
import type { ModelProvider } from '@openai/agents';
import { LocalToolCallingModel } from './local-model.js';
import { createSwarmAgents } from './agents.js';

// Desabilitar tracing para modelos locais — evita overhead de memória e rede
setTracingDisabled(true);

export interface OpenAIAgentConfig {
  workspaceRoot: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  maxTurns?: number;
  onUpdate?: (update: { role: string; content: string }) => void;
}

/**
 * ModelProvider usando nosso LocalToolCallingModel.
 * 
 * Este modelo intercepta respostas de modelos locais que colocam
 * tool calls dentro do `content` (como JSON) em vez de usar o
 * campo `tool_calls` nativo da API — comportamento comum no
 * Ollama e LM Studio com Qwen, DeepSeek, Llama, etc.
 */
function createLocalModelProvider(client: OpenAI, defaultModel: string): ModelProvider {
  return {
    getModel(_modelName?: string) {
      const model = _modelName || defaultModel;
      return new LocalToolCallingModel(client, model) as any;
    },
  };
}

/**
 * Remove tokens especiais que modelos locais às vezes vazam na saída.
 */
function cleanModelOutput(text: string): string {
  return text
    .replace(/<\|[a-z_]+\|>/gi, '')
    .replace(/<\/?(think|tool_call)>/gi, '')
    .replace(/```json\s*```/g, '')
    .replace(/```\s*```/g, '')
    .trim();
}

export async function runOpenAIAgent(task: string, config: OpenAIAgentConfig) {
  const { plannerAgent } = createSwarmAgents(config.workspaceRoot);

  const client = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey || 'lm-studio',
  });

  const maxTurns = config.maxTurns ?? 15;
  const runner = new Runner({
    modelProvider: createLocalModelProvider(client, config.model),
    tracingDisabled: true,
  });

  config.onUpdate?.({ role: 'system', content: `Modelo: ${config.model} | MaxTurns: ${maxTurns}` });

  const result = await runner.run(plannerAgent, task, { maxTurns });

  // Extrair output final
  let content = '';

  try {
    const finalOutput = result.finalOutput;
    if (finalOutput && typeof finalOutput === 'string') {
      content = cleanModelOutput(finalOutput);
    } else if (finalOutput) {
      content = JSON.stringify(finalOutput);
    }
  } catch {
    // finalOutput pode não existir
  }

  if (!content) {
    try {
      const allText = extractAllTextOutput(result.newItems);
      if (allText) {
        content = cleanModelOutput(allText);
      }
    } catch {
      // Manter vazio
    }
  }

  if (!content) {
    const items = result.newItems || [];
    const toolOutputs = items.filter((item: any) =>
      item.type === 'tool_call_output_item' ||
      item.type === 'tool_call_item'
    );

    if (toolOutputs.length > 0) {
      content = `Executou ${toolOutputs.length} operações com ferramentas.`;
    } else {
      content = 'Finalizado sem conteúdo retornado.';
    }
  }

  config.onUpdate?.({ role: 'assistant', content });
  return result;
}
