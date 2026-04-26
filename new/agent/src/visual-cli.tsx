#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { render } from 'ink';
import { OrchestratorAgent } from './agent/orchestrator.js';
import { ContextManager } from './context/manager.js';
import { RouterLLMAdapter, LLMRouter } from './llm/router.js';
import { LMStudioProvider, OllamaProvider, providerFromEnv } from './llm/providers.js';
import { UnifiedLogger } from './observability/logger.js';
import { CheckpointManager, FileCheckpointStorage } from './state/checkpoint.js';
import { createDevelopmentToolRegistry } from './tools/development-tools.js';
import { App } from './ui/App.js';
import { loadEnv } from './utils/env.js';

// Load environment variables from .env file manually
loadEnv();

type ProviderName = 'openai' | 'anthropic' | 'openrouter' | 'lmstudio' | 'ollama';

function resolveProviderName(args: string[]): ProviderName {
  let fallbackProvider: ProviderName = (process.env.AGENT_LLM_PROVIDER as ProviderName) || 'lmstudio';

  if (process.env.OPENAI_API_KEY) {
    fallbackProvider = 'openai';
  } else if (process.env.ANTHROPIC_API_KEY) {
    fallbackProvider = 'anthropic';
  } else if (process.env.OPENROUTER_API_KEY) {
    fallbackProvider = 'openrouter';
  }

  const rawProvider = args.find((arg) => arg.startsWith('--provider='))?.split('=')[1];
  const providerName = (rawProvider ?? fallbackProvider) as ProviderName;

  if (['openai', 'anthropic', 'openrouter', 'lmstudio', 'ollama'].includes(providerName)) {
    return providerName;
  }

  throw new Error(`Provider invalido: ${providerName}. Use openai, anthropic, openrouter, lmstudio ou ollama.`);
}

function resolveSandboxMode(args: string[]): any {
  const rawSandbox = args.find((arg) => arg.startsWith('--sandbox='))?.split('=')[1];
  if (rawSandbox && ['docker', 'native', 'auto'].includes(rawSandbox)) {
    return rawSandbox;
  }
  return 'auto';
}

function resolveProvider(providerName: ProviderName) {
  if (providerName === 'lmstudio') {
    return new LMStudioProvider();
  }

  if (providerName === 'ollama') {
    return new OllamaProvider({
      defaultModel: process.env.AGENT_LLM_MODEL,
      baseUrl: process.env.AGENT_LLM_BASE_URL
    });
  }

  return providerFromEnv(providerName);
}

async function main() {
  const args = process.argv.slice(2);
  const providerName = resolveProviderName(args);
  const positionalArgs = args.filter((arg) => !arg.startsWith('--'));
  const command = positionalArgs[0];
  
  let workspaceRoot = process.cwd();
  const checkpointStorage = new FileCheckpointStorage(path.join(workspaceRoot, '.agent', 'checkpoints'));
  const checkpointManager = new CheckpointManager(checkpointStorage);

  // COMMAND: LIST
  if (command === 'list') {
    const checkpoints = await checkpointManager.list();
    if (checkpoints.length === 0) {
      console.log('Nenhuma sessao encontrada.');
      return;
    }
    console.log('\n--- SESSOES DO AGENTE ---');
    checkpoints.forEach((cp) => {
      const date = new Date(cp.updatedAt).toLocaleString('pt-BR');
      console.log(`[${cp.id}] ${cp.status.padEnd(10)} | ${date} | ${cp.currentTask?.slice(0, 50)}...`);
    });
    return;
  }

  let initialTask = positionalArgs.join(' ').trim() || 'Oi! Como posso te ajudar hoje?';
  let initialState: any = undefined;

  // COMMAND: RESUME
  if (command === 'resume') {
    const resumeId = positionalArgs[1];
    if (!resumeId) {
      console.error('Erro: Forneca o ID da sessao para retomar.');
      process.exit(1);
    }
    initialState = await checkpointManager.resumeFromCheckpoint(resumeId);
    if (!initialState) {
      console.error(`Erro: Sessao ${resumeId} nao encontrada.`);
      process.exit(1);
    }
    initialTask = initialState.currentTask || 'Oi! Como posso te ajudar hoje?';
  } else if (positionalArgs.length > 0) {
    // If the first positional argument is a valid directory, use it as workspaceRoot
    const candidatePath = path.resolve(process.cwd(), positionalArgs[0]);
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
      workspaceRoot = candidatePath;
      initialTask = positionalArgs.slice(1).join(' ').trim() || 'Oi! Como posso te ajudar hoje?';
    }
  }

  const registry = createDevelopmentToolRegistry({ workspaceRoot });
  const contextManager = new ContextManager({
    maxTokensEstimate: 3000,
    summarizeThreshold: 20,
  });
  const logger = new UnifiedLogger({ logDirectory: path.join(workspaceRoot, '.agent', 'logs') });
  const provider = resolveProvider(providerName);

  const router = new LLMRouter([provider], {
    primaryProvider: provider.name,
    fallbackProviders: [],
    timeoutMs: 300000,
    taskModelPreferences: {},
  });
  const llm = new RouterLLMAdapter(router);

  const orchestrator = new OrchestratorAgent({
    llm,
    registry,
    checkpointManager,
    contextManager,
    logger,
    sandboxMode: resolveSandboxMode(args),
    humanApprovalCallback: async () => true,
    llmConfig: {
      model: provider.defaultModel,
      temperature: 0.2,
    },
  });

  const { waitUntilExit } = render(
    <App 
      orchestrator={orchestrator} 
      initialTask={initialTask} 
      initialState={initialState} 
      modelName={provider.defaultModel}
      providerName={providerName}
    />
  );

  await waitUntilExit();
}

main().catch((error) => {
  console.error('Falha ao iniciar a interface visual:', error);
  process.exit(1);
});
