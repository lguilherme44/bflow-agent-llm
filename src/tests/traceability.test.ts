import test from 'node:test';
import assert from 'node:assert/strict';
import { OrchestratorAgent } from '../agent/orchestrator.js';
import { createTestTracing } from '../observability/tracing.js';
import { UnifiedLogger } from '../observability/logger.js';
import { ToolRegistry } from '../tools/registry.js';
import { ContextManager } from '../context/manager.js';
import { MockLLMAdapter } from '../llm/adapter.js';
import * as fs from 'node:fs/promises';

test('Orchestrator Traceability', async () => {
  const tracing = createTestTracing();
  const logger = new UnifiedLogger({ logDirectory: './test-logs-trace' });
  const registry = new ToolRegistry();
  const llm = new MockLLMAdapter();

  // Register essential tools
  registry.register({
      schema: { name: 'complete_task', summary: 'Complete task', parameters: { type: 'object', properties: { summary: { type: 'string' } } } },
      handler: async (args: any) => ({ summary: args.summary, completed: true })
  } as any);

  try {
    // 1. Mock Intent Classification (TASK)
    llm.pushDefaultResponse('TASK');

    // 2. Mock Research
    llm.pushDefaultResponse(JSON.stringify({ 
        thought: 'Researching...', 
        tool: 'submit_research_brief', 
        arguments: { taskType: 'feature', entryPoints: [], dependencies: [], risks: [], summary: 'Done' } 
    }));

    // 3. Mock Planning
    llm.pushDefaultResponse(JSON.stringify({ 
        thought: 'Planning...', 
        tool: 'submit_execution_plan', 
        arguments: { summary: 'Plan', estimatedRisk: 'low', streams: [{ id: '1', name: 'Stream 1', owner: 'coder', tasks: ['Task 1'], validations: [] }] } 
    }));

    // 4. Mock Execution
    llm.pushDefaultResponse(JSON.stringify({ 
        thought: 'Executing...', 
        tool: 'complete_task', 
        arguments: { summary: 'Finished' } 
    }));

    const orchestrator = new OrchestratorAgent({
        llm,
        registry,
        checkpointManager: { checkpoint: async () => {}, resumeFromCheckpoint: async () => null } as any,
        contextManager: new ContextManager(),
        tracing,
        logger,
    });

    await orchestrator.run('Test task');

    const spans = tracing.getFinishedSpans();
    const spanNames = spans.map(s => s.name);

    assert.ok(spanNames.includes('orchestrator:run'), 'Should have orchestrator span');
    assert.ok(spanNames.includes('phase:Intent Classification'), 'Should have intent phase span');
    assert.ok(spanNames.includes('phase:Research'), 'Should have research phase span');
    assert.ok(spanNames.includes('phase:Planning'), 'Should have planning phase span');
    assert.ok(spanNames.includes('phase:Execution'), 'Should have execution phase span');
    assert.ok(spanNames.includes('phase:Stream: Stream 1'), 'Should have stream phase span');
    assert.ok(spanNames.includes('agent:run'), 'Should have agent spans');

    // Verify relationships
    const orchestratorSpan = spans.find(s => s.name === 'orchestrator:run');
    const researchPhaseSpan = spans.find(s => s.name === 'phase:Research');
    
    assert.equal(researchPhaseSpan?.parentSpanId, orchestratorSpan?.spanContext().spanId, 'Research phase should be child of orchestrator');
    
    const researchAgentSpan = spans.find(s => s.name === 'agent:run' && s.attributes['agent.task']?.toString().includes('Research'));
    assert.equal(researchAgentSpan?.parentSpanId, researchPhaseSpan?.spanContext().spanId, 'Research agent should be child of research phase');

  } finally {
    await fs.rm('./test-logs-trace', { recursive: true, force: true });
  }
});
