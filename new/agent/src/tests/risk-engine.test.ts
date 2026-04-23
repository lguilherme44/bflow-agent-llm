import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RiskPolicyEngine } from '../utils/risk-engine.js';

describe('RiskPolicyEngine', () => {
  const engine = new RiskPolicyEngine();

  it('should identify low risk for read_file', () => {
    const evaluation = engine.evaluateToolCall('read_file', { filepath: 'src/index.ts' });
    assert.strictEqual(evaluation.level, 'low');
    assert.strictEqual(evaluation.score, 0);
  });

  it('should identify medium risk for execute_command', () => {
    const evaluation = engine.evaluateToolCall('execute_command', { command: 'npm test' });
    assert.strictEqual(evaluation.level, 'medium');
    assert.strictEqual(evaluation.score, 30);
  });

  it('should identify high risk for dangerous commands', () => {
    const evaluation = engine.evaluateToolCall('execute_command', { command: 'del /s *' });
    assert.strictEqual(evaluation.level, 'high');
    assert.ok(evaluation.score >= 80);
    assert.ok(evaluation.reasons.some(r => r.includes('Recursive deletion')));
  });

  it('should block root deletion', () => {
    const evaluation = engine.evaluateToolCall('execute_command', { command: 'rm -rf /' });
    assert.strictEqual(evaluation.level, 'blocked');
    assert.strictEqual(evaluation.score, 100);
  });

  it('should identify high risk for sensitive files', () => {
    const evaluation = engine.evaluateToolCall('write_file', { filepath: '.env', content: 'FOO=BAR' });
    assert.strictEqual(evaluation.level, 'high');
    assert.ok(evaluation.reasons.some(r => r.includes('Accessing sensitive file')));
  });
});
