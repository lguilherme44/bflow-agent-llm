#!/usr/bin/env node
import { OrchestratorAgent } from './agent/orchestrator.js';
import { ContextManager } from './context/manager.js';
import { CheckpointManager, FileCheckpointStorage } from './state/checkpoint.js';
import { createDevelopmentToolRegistry } from './tools/development-tools.js';
import { providerFromEnv, LMStudioProvider, OllamaProvider } from './llm/providers.js';
import { RouterLLMAdapter, LLMRouter } from './llm/router.js';
import { UnifiedLogger } from './observability/logger.js';
import path from 'node:path';
import fs from 'node:fs';

async function main() {
  const args = process.argv.slice(2);
  
  // Default logic: environment variable or fallback to lmstudio
  let defaultProvider = 'lmstudio';
  if (process.env.OPENAI_API_KEY) defaultProvider = 'openai';
  else if (process.env.ANTHROPIC_API_KEY) defaultProvider = 'anthropic';

  const providerName = (args.find(a => a.startsWith('--provider=')) || `--provider=${defaultProvider}`).split('=')[1];
  
  // Logs moved after final task resolution

  const positionalArgs = args.filter(a => !a.startsWith('--'));
  const command = positionalArgs[0];

  const workspaceRoot = process.cwd();
  const checkpointStorage = new FileCheckpointStorage(path.join(workspaceRoot, '.agent', 'checkpoints'));
  const checkpointManager = new CheckpointManager(checkpointStorage);
  const registry = createDevelopmentToolRegistry({ workspaceRoot });
  const contextManager = new ContextManager();
  const logger = new UnifiedLogger({ logDirectory: path.join(workspaceRoot, '.agent', 'logs') });

  // COMMAND: LIST
  if (command === 'list') {
    const checkpoints = await checkpointManager.list();
    if (checkpoints.length === 0) {
      console.log('No checkpoints found.');
      return;
    }

    console.log('\n--- AGENT SESSIONS ---');
    checkpoints.forEach((cp) => {
      const date = new Date(cp.updatedAt).toLocaleString();
      console.log(`[${cp.id}] ${cp.status.padEnd(10)} | ${date} | ${cp.currentTask?.slice(0, 50)}...`);
    });
    return;
  }

  let task = positionalArgs.join(' ') || 'Oi! Como posso te ajudar hoje?';
  let resumeId: string | undefined;

  // COMMAND: RESUME
  if (command === 'resume') {
    resumeId = positionalArgs[1];
    if (!resumeId) {
      console.error('Error: Please provide a session ID to resume.');
      return;
    }
  }

  // If the first positional argument is a valid directory, use it as workspaceRoot (for new tasks)
  if (!resumeId && positionalArgs.length > 0) {
    const candidatePath = path.resolve(process.cwd(), positionalArgs[0]);
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
      // Shift args if a directory was provided
      task = positionalArgs.slice(1).join(' ') || 'Oi! Como posso te ajudar hoje?';
    }
  }

  console.log(`Starting agent with provider: ${providerName}`);
  console.log(`Workspace: ${workspaceRoot}`);
  if (resumeId) console.log(`Resuming session: ${resumeId}`);
  else console.log(`Task: ${task}`);

  let provider;
  // ... rest of provider resolution ...
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
    let result;
    if (resumeId) {
      const state = await checkpointManager.resumeFromCheckpoint(resumeId);
      if (!state) {
        console.error(`Error: Session ${resumeId} not found.`);
        return;
      }
      result = await orchestrator.run(state.currentTask || 'Resume task', state);
    } else {
      result = await orchestrator.run(task);
    }

    const { state } = result;
    console.log(`\nTask finished with status: ${state.status}`);
    // ... rest of log output ...
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
