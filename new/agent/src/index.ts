export { ReActAgent } from './agent/react-loop';
export { ContextManager } from './context/manager';
export { MockLLMAdapter, OpenAIAdapter, LLMResponseParser } from './llm/adapter';
export { LLMRouter, RouterLLMAdapter } from './llm/router';
export { AnthropicProvider, MockLLMProvider, OpenAIProvider, OpenRouterProvider, providerFromEnv } from './llm/providers';
export { redactMessages, redactSecrets } from './llm/redaction';
export { PromptLibrary } from './prompts/library';
export { LocalRagService } from './rag/local-rag';
export { CheckpointManager, FileCheckpointStorage, InMemoryCheckpointStorage } from './state/checkpoint';
export { AgentStateMachine } from './state/machine';
export { CodeEditingService } from './code/editing-service';
export { TreeSitterParserService } from './code/tree-sitter-parser';
export { AstGrepService } from './code/ast-grep-service';
export { TypeScriptLanguageService } from './code/typescript-language-service';
export { TerminalService } from './code/terminal-service';
export { createDevelopmentToolRegistry } from './tools/development-tools';
export { ToolExecutor } from './tools/executor';
export { ToolRegistry } from './tools/registry';
export { createTool } from './tools/schema';
export * from './types';

import { ReActAgent } from './agent/react-loop';
import { ContextManager } from './context/manager';
import { MockLLMAdapter } from './llm/adapter';
import { CheckpointManager, FileCheckpointStorage } from './state/checkpoint';
import { createDevelopmentToolRegistry } from './tools/development-tools';

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
