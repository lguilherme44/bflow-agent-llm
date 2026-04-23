import { render } from 'ink';
import { App } from './ui/App.js';
import { OrchestratorAgent } from './agent/orchestrator.js';
import { ContextManager } from './context/manager.js';
import { CheckpointManager, FileCheckpointStorage } from './state/checkpoint.js';
import { createDevelopmentToolRegistry } from './tools/development-tools.js';
import { providerFromEnv, LMStudioProvider } from './llm/providers.js';
import { RouterLLMAdapter, LLMRouter } from './llm/router.js';
import { UnifiedLogger } from './observability/logger.js';
import path from 'path';
import readline from 'readline';

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n--- ANTIGRAVITY AGENT OS ---');
  
  // Pegamos a tarefa via readline (estável)
  const task = await new Promise<string>((resolve) => {
    rl.question('\nO que deseja fazer hoje? > ', (answer) => {
      rl.close();
      resolve(answer);
    });
  });

  if (!task.trim()) {
    console.log('Tarefa vazia. Saindo...');
    return;
  }

  const workspaceRoot = process.cwd();
  const registry = createDevelopmentToolRegistry({ workspaceRoot });
  const checkpointManager = new CheckpointManager(new FileCheckpointStorage(path.join(workspaceRoot, '.agent', 'checkpoints')));
  const contextManager = new ContextManager();
  const logger = new UnifiedLogger({ logDirectory: path.join(workspaceRoot, '.agent', 'logs') });

  const provider = process.env.OPENAI_API_KEY ? providerFromEnv('openai') : new LMStudioProvider();

  const router = new LLMRouter([provider], {
    primaryProvider: provider.name,
    fallbackProviders: [],
    timeoutMs: 120000,
    taskModelPreferences: {}
  });
  const llm = new RouterLLMAdapter(router);

  const orchestrator = new OrchestratorAgent({
    llm,
    registry,
    checkpointManager,
    contextManager,
    logger,
    humanApprovalCallback: async (_toolCall) => {
      // Por enquanto aprova automático no modo visual híbrido
      return true;
    },
    llmConfig: {
      model: provider.defaultModel,
      temperature: 0.2
    }
  });

  // Iniciamos a UI visual para mostrar o progresso da tarefa capturada
  console.log('\nIniciando Dashboard Visual...\n');
  const { waitUntilExit } = render(<App orchestrator={orchestrator} initialTask={task} />);

  await waitUntilExit();
}

main().catch((error) => {
  console.error('TUI Fatal Error:', error);
  process.exit(1);
});
