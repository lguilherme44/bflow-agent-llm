import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { createSwarmAgents } from '../agent/openai-agents/agents.js';

describe('OpenAI Agents', () => {
  it('should create single unified agent for 7B VRAM optimizations', () => {
    const agents = createSwarmAgents(process.cwd());
    
    // As we decided, the planner, reviewer and coder agents are just references 
    // to the single unified coderAgent to avoid handoff overhead
    assert.strictEqual(agents.plannerAgent, agents.coderAgent);
    assert.strictEqual(agents.reviewerAgent, agents.coderAgent);
    
    // Agent should have all necessary tools loaded
    const toolNames = agents.coderAgent.tools.map(t => t.name);
    assert.ok(toolNames.includes('read_file'));
    assert.ok(toolNames.includes('execute_command'));
    assert.ok(toolNames.includes('create_file'));
    assert.ok(toolNames.includes('edit_file'));
    assert.ok(toolNames.includes('complete_task'));
  });
});
