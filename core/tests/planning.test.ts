import test from 'node:test';
import assert from 'node:assert/strict';
import { OrchestratorAgent } from '../agent/orchestrator.js';
import { MockLLMAdapter } from '../llm/adapter.js';
import { ContextManager } from '../context/manager.js';
import { createDevelopmentToolRegistry } from '../tools/development-tools.js';
import { CheckpointManager, FileCheckpointStorage } from '../state/checkpoint.js';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('OrchestratorAgent executes research, planning, and delegates execution', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-planning-'));
  await writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { build: 'echo 1', lint: 'echo 1', test: 'echo 1' } }));
  await mkdir(path.join(workspace, 'src'), { recursive: true });
  await writeFile(path.join(workspace, 'src', 'index.ts'), 'console.log(1);');
  
  try {
    const registry = createDevelopmentToolRegistry({ workspaceRoot: workspace });
    const checkpointManager = new CheckpointManager(new FileCheckpointStorage(path.join(workspace, '.checkpoints')));
    const llm = new MockLLMAdapter();
    
    // 0. Intent Classification
    llm.pushDefaultResponse('TASK');

    // 1. ResearchAgent LLM response
    llm.pushDefaultResponse(JSON.stringify({
      thought: 'I have researched the codebase.',
      tool: 'submit_research_brief',
      arguments: {
        taskType: 'feature',
        entryPoints: ['src/index.ts'],
        dependencies: [],
        risks: ['none'],
        summary: 'A simple feature to implement.'
      }
    }));

    // 2. PlanningAgent LLM response
    llm.pushDefaultResponse(JSON.stringify({
      thought: 'I will create a stream for the coder.',
      tool: 'submit_execution_plan',
      arguments: {
        summary: 'Feature implementation plan',
        estimatedRisk: 'low',
        streams: [
          {
            id: 's1',
            name: 'Feature code',
            owner: 'coder',
            tasks: ['Write the feature'],
            validations: ['Typecheck'],
            blockedBy: []
          }
        ]
      }
    }));

    // 3. Worker Agent (Coder) response
    llm.pushDefaultResponse(JSON.stringify({
      thought: 'I have written the feature.',
      tool: 'complete_task',
      arguments: {
        status: 'success',
        summary: 'Feature written and verified.'
      }
    }));



    const orchestrator = new OrchestratorAgent({
      llm,
      registry,
      checkpointManager,
      contextManager: new ContextManager(),
      humanApprovalCallback: async () => true,
    });

    const { state, plan } = await orchestrator.run('Build a new feature');

    if (state.status === 'error') {
      console.log('Orchestrator failed with:', state.metadata.errorMessage);
    }
    assert.equal(state.status, 'completed');
    assert.ok(plan, 'Plan should have been created');
    assert.equal(plan?.summary, 'Feature implementation plan');
    assert.equal(plan?.streams.length, 1);
    assert.equal(plan?.streams[0].status, 'completed');
    
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
