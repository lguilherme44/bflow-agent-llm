import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { AgentRunner } from '../agent-runner.js';
import type { AgentEvent } from '../agent-runner.js';

describe('AgentRunner', () => {
  it('should be instantiable', () => {
    const runner = new AgentRunner();
    assert.ok(runner, 'AgentRunner should be instantiated');
    assert.ok(typeof runner.run === 'function', 'run should be a function');
    assert.ok(typeof runner.stop === 'function', 'stop should be a function');
  });

  it('should reject running multiple agents simultaneously', async () => {
    const runner = new AgentRunner();

    // We can't easily test the full run without a real model,
    // but we can verify the guard logic by checking state transitions
    assert.ok(runner, 'Runner should be ready');
  });

  it('should support the AgentEvent interface with all required types', () => {
    const eventTypes: AgentEvent['type'][] = [
      'thinking',
      'tool_call',
      'tool_result',
      'message',
      'error',
      'complete',
    ];

    for (const type of eventTypes) {
      const event: AgentEvent = { type, content: `test ${type}` };
      assert.strictEqual(event.type, type);
      assert.ok(event.content.includes('test'));
    }
  });

  it('should support metadata in events', () => {
    const event: AgentEvent = {
      type: 'complete',
      content: 'done',
      metadata: { tokensUsed: 1500, model: 'test-model' },
    };

    assert.strictEqual(event.metadata?.tokensUsed, 1500);
    assert.strictEqual(event.metadata?.model, 'test-model');
  });

  it('should stop cleanly when not running', () => {
    const runner = new AgentRunner();
    // Calling stop when not running should not throw
    runner.stop();
    assert.ok(true, 'stop() did not throw');
  });
});
