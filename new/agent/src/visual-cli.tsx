import path from 'path';
import { render } from 'ink';
import { OrchestratorAgent } from './agent/orchestrator.js';
import { ContextManager } from './context/manager.js';
import { RouterLLMAdapter, LLMRouter } from './llm/router.js';
import { LMStudioProvider, OllamaProvider, providerFromEnv } from './llm/providers.js';
import { UnifiedLogger } from './observability/logger.js';
import { CheckpointManager, FileCheckpointStorage } from './state/checkpoint.js';
import { createDevelopmentToolRegistry } from './tools/development-tools.js';
import { App } from './ui/App.js';

type ProviderName = 'openai' | 'anthropic' | 'openrouter' | 'lmstudio' | 'ollama';

function resolveProviderName(args: string[]): ProviderName {
  let fallbackProvider: ProviderName = 'lmstudio';

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

function resolveProvider(providerName: ProviderName) {
  if (providerName === 'lmstudio') {
    return new LMStudioProvider();
  }

  if (providerName === 'ollama') {
    return new OllamaProvider();
  }

  return providerFromEnv(providerName);
}

async function main() {
  const args = process.argv.slice(2);
  const providerName = resolveProviderName(args);
  const initialTask = args.filter((arg) => !arg.startsWith('--')).join(' ').trim();

  const workspaceRoot = process.cwd();
  const registry = createDevelopmentToolRegistry({ workspaceRoot });
  const checkpointManager = new CheckpointManager(
    new FileCheckpointStorage(path.join(workspaceRoot, '.agent', 'checkpoints'))
  );
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
    // The orchestrator replaces this callback with the interactive visual approval flow.
    humanApprovalCallback: async () => true,
    llmConfig: {
      model: provider.defaultModel,
      temperature: 0.2,
    },
  });

  const { waitUntilExit } = render(
    <App orchestrator={orchestrator} initialTask={initialTask} />
  );

  await waitUntilExit();
}

main().catch((error) => {
  console.error('Falha ao iniciar a interface visual:', error);
  process.exit(1);
});
