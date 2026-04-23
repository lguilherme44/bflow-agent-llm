import { OrchestratorAgent } from './agent/orchestrator';
import { ContextManager } from './context/manager';
import { CheckpointManager, FileCheckpointStorage } from './state/checkpoint';
import { createDevelopmentToolRegistry } from './tools/development-tools';
import { providerFromEnv, LMStudioProvider, OllamaProvider } from './llm/providers';
import { RouterLLMAdapter, LLMRouter } from './llm/router';
import { UnifiedLogger } from './observability/logger';
import path from 'path';

async function main() {
  const args = process.argv.slice(2);
  const task = args.filter(a => !a.startsWith('--')).join(' ') || 'Explore the codebase';
  
  // Default logic: environment variable or fallback to lmstudio
  let defaultProvider = 'lmstudio';
  if (process.env.OPENAI_API_KEY) defaultProvider = 'openai';
  else if (process.env.ANTHROPIC_API_KEY) defaultProvider = 'anthropic';

  const providerName = (args.find(a => a.startsWith('--provider=')) || `--provider=${defaultProvider}`).split('=')[1];
  
  console.log(`Starting agent with provider: ${providerName}`);
  console.log(`Task: ${task}`);

  const workspaceRoot = process.cwd();
  const registry = createDevelopmentToolRegistry({ workspaceRoot });
  const checkpointManager = new CheckpointManager(new FileCheckpointStorage(path.join(workspaceRoot, '.agent', 'checkpoints')));
  const contextManager = new ContextManager();
  const logger = new UnifiedLogger({ logDirectory: path.join(workspaceRoot, '.agent', 'logs') });

  let provider;
  if (providerName === 'lmstudio') {
    provider = new LMStudioProvider();
  } else if (providerName === 'ollama') {
    provider = new OllamaProvider();
  } else {
    provider = providerFromEnv(providerName as any);
  }

  const router = new LLMRouter([provider], {
    primaryProvider: provider.name,
    fallbackProviders: [],
    timeoutMs: 120000, // Local models can be slow
    taskModelPreferences: {}
  });
  const llm = new RouterLLMAdapter(router);

  const orchestrator = new OrchestratorAgent({
    llm,
    registry,
    checkpointManager,
    contextManager,
    logger,
    humanApprovalCallback: async (toolCall) => {
      console.log(`\n[HITL] Approval required for: ${toolCall.toolName}`);
      console.log(`Arguments: ${JSON.stringify(toolCall.arguments, null, 2)}`);
      return true;
    },
    llmConfig: {
      model: provider.defaultModel,
      temperature: 0.2
    }
  });

  try {
    const { state } = await orchestrator.run(task);
    console.log(`\nTask finished with status: ${state.status}`);
    if (state.status === 'completed') {
      console.log('Summary:', state.messages.filter(m => m.role === 'assistant').at(-1)?.content);
    } else if (state.status === 'error') {
      console.error('Error:', state.metadata.errorMessage);
      console.log('\nLast few messages:');
      state.messages.slice(-5).forEach(m => {
        console.log(`[${m.role}] ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`);
      });
    }
  } catch (error) {
    console.error('Execution failed:', error);
  }
}

main().catch(console.error);
