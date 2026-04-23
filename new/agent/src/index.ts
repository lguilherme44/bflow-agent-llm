export { ReActAgent } from './agent/react-loop.js';
export { ContextManager } from './context/manager.js';
export { MockLLMAdapter, OpenAIAdapter, LLMResponseParser } from './llm/adapter.js';
export { LLMRouter, RouterLLMAdapter } from './llm/router.js';
export { AnthropicProvider, LMStudioProvider, MockLLMProvider, OllamaProvider, OpenAIProvider, OpenRouterProvider, providerFromEnv } from './llm/providers.js';
export { redactMessages, redactSecrets } from './llm/redaction.js';
export { PromptLibrary } from './prompts/library.js';
export { LocalRagService } from './rag/local-rag.js';
export { CheckpointManager, FileCheckpointStorage, InMemoryCheckpointStorage } from './state/checkpoint.js';
export { AgentStateMachine } from './state/machine.js';
export { CodeEditingService } from './code/editing-service.js';
export { TreeSitterParserService } from './code/tree-sitter-parser.js';
export { AstGrepService } from './code/ast-grep-service.js';
export { TypeScriptLanguageService } from './code/typescript-language-service.js';
export { TerminalService } from './code/terminal-service.js';
export { createDevelopmentToolRegistry } from './tools/development-tools.js';
export { ToolExecutor } from './tools/executor.js';
export { ToolRegistry } from './tools/registry.js';
export { createTool } from './tools/schema.js';
export * from './types/index.js';

import { ReActAgent } from './agent/react-loop.js';
import { ContextManager } from './context/manager.js';
import { MockLLMAdapter } from './llm/adapter.js';
import { CheckpointManager, FileCheckpointStorage } from './state/checkpoint.js';
import { createDevelopmentToolRegistry } from './tools/development-tools.js';

async function demo(): Promise<void> {
  const registry = createDevelopmentToolRegistry({ workspaceRoot: process.cwd() });
  const checkpointManager = new CheckpointManager(new FileCheckpointStorage('.agent-checkpoints'));
  const contextManager = new ContextManager();
  const llm = new MockLLMAdapter();

  llm.setResponses('Demonstrate the agent core', [
    JSON.stringify({
      thought: 'I will inspect the entrypoint before completing the demo.',
      tool: 'read_file',
      arguments: { filepath: 'src/index.ts' },
    }),
    JSON.stringify({
      thought: 'The file was read and the demo can finish.',
      tool: 'complete_task',
      arguments: { status: 'success', summary: 'Demo read src/index.ts and completed.' },
    }),
  ]);

  const agent = new ReActAgent({
    llm,
    registry,
    checkpointManager,
    contextManager,
    humanApprovalCallback: async () => true,
  });

  const finalState = await agent.run('Demonstrate the agent core');
  console.log(`Status: ${finalState.status}`);
  console.log(`Iterations: ${finalState.metadata.iterationCount}`);
  console.log(`Tool calls: ${finalState.toolHistory.length}`);
  console.log(`Checkpoint: ${finalState.id}`);
}

if (require.main === module) {
  demo().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
