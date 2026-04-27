
import { OrchestratorAgent } from '../src/agent/orchestrator.js';
import { AgentStateMachine } from '../src/state/machine.js';
import { LLMAdapter } from '../src/llm/adapter.js';

// Mock LLM
const mockLLM: LLMAdapter = {
  name: 'mock',
  complete: async (messages) => ({
    content: 'TypeScript is a typed superset of JavaScript.',
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    latencyMs: 100
  })
};

const orchestrator = new OrchestratorAgent({
  llm: mockLLM,
  registry: { get: () => null, list: () => [], generateToolPrompt: () => '' } as any,
  checkpointManager: { checkpoint: async () => {} } as any,
  contextManager: { prepareMessages: () => [] } as any,
  llmConfig: { model: 'mock' }
});

async function test() {
  console.log('Testing DIRECT intent response...');
  const result = await orchestrator.run('o que é typescript');
  
  console.log('Final Status:', result.state.status);
  console.log('Message roles:', result.state.messages.map(m => m.role));
  
  const assistantMessage = result.state.messages.find(m => m.role === 'assistant');
  if (assistantMessage) {
    console.log('✅ Assistant message found:', assistantMessage.content);
  } else {
    console.log('❌ Assistant message NOT found!');
    process.exit(1);
  }
}

test().catch(console.error);
