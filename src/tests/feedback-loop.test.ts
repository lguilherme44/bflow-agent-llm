import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackLoopEngine } from '../agent/feedback-loop.js';
import { AgentStateMachine } from '../state/machine.js';
import { AgentState, ExecutionStream, ToolCall, ToolResult } from '../types/index.js';
import { createTestTracing } from '../observability/tracing.js';

// ── Helpers ──────────────────────────────────────────────────

function createMockStream(overrides?: Partial<ExecutionStream>): ExecutionStream {
  return {
    id: 'stream-1',
    name: 'Test Stream',
    owner: 'coder',
    tasks: ['Implement feature X'],
    validations: ['build', 'test'],
    status: 'failed',
    blockedBy: [],
    ...overrides,
  };
}

function createFailedState(errorMessage: string, toolErrors?: string[]): AgentState {
  const state = AgentStateMachine.create('test task');
  let current = AgentStateMachine.dispatch(state, { type: 'task_started' });

  // Add tool history with failures if provided
  if (toolErrors) {
    for (const err of toolErrors) {
      const toolCall: ToolCall = {
        id: `tc-${Math.random().toString(36).slice(2, 8)}`,
        toolName: 'run_tests',
        arguments: {},
        timestamp: new Date().toISOString(),
      };
      const result: ToolResult = {
        toolCallId: toolCall.id,
        success: false,
        data: null,
        error: err,
        durationMs: 100,
        timestamp: new Date().toISOString(),
        attempts: 1,
        timedOut: false,
        recoverable: true,
      };
      current = AgentStateMachine.addToolExecution(current, toolCall, result);
    }
  }

  return AgentStateMachine.fail(current, errorMessage);
}

// ── Tests ────────────────────────────────────────────────────

describe('FeedbackLoopEngine', () => {
  describe('classifyFailure', () => {
    it('classifies test failures from worker state', () => {
      const engine = new FeedbackLoopEngine();
      const stream = createMockStream();
      const state = createFailedState('Test validation failed (exit code 1)', [
        'assertion error: expected 1 to equal 2',
      ]);

      const kind = engine.classifyFailure(state, stream);
      assert.equal(kind, 'test_failure');
    });

    it('classifies build failures from worker state', () => {
      const engine = new FeedbackLoopEngine();
      const stream = createMockStream();
      const state = createFailedState('Build validation failed (exit code 1)', [
        'error TS2304: Cannot find name "foo"',
      ]);

      const kind = engine.classifyFailure(state, stream);
      assert.equal(kind, 'build_failure');
    });

    it('classifies lint failures from error string', () => {
      const engine = new FeedbackLoopEngine();
      const kind = engine.classifyFromError('Lint validation failed (exit code 1)');
      assert.equal(kind, 'lint_failure');
    });

    it('classifies review rejections from error string', () => {
      const engine = new FeedbackLoopEngine();
      const kind = engine.classifyFromError('Code rejected by reviewer: vulnerability found');
      assert.equal(kind, 'review_rejection');
    });

    it('returns unknown for unrecognized errors', () => {
      const engine = new FeedbackLoopEngine();
      const kind = engine.classifyFromError('Something completely unexpected happened');
      assert.equal(kind, 'unknown');
    });
  });

  describe('shouldRetry', () => {
    it('allows retries within limit', () => {
      const engine = new FeedbackLoopEngine({ maxRetries: 3, maxCostTokens: 500_000 });
      assert.equal(engine.shouldRetry('stream-1', 1000), true);
    });

    it('blocks retries after max iterations', () => {
      const engine = new FeedbackLoopEngine({ maxRetries: 2, maxCostTokens: 500_000 });

      // Record 2 iterations
      engine.recordIteration({
        iteration: 1, failureKind: 'test_failure', delegatedTo: 'coder',
        streamId: 'stream-1', recoveryStreamId: 'stream-1-recovery-1',
        error: 'test failed', resolved: false, tokensBefore: 0,
      });
      engine.recordIteration({
        iteration: 2, failureKind: 'test_failure', delegatedTo: 'coder',
        streamId: 'stream-1', recoveryStreamId: 'stream-1-recovery-2',
        error: 'test failed again', resolved: false, tokensBefore: 1000,
      });

      assert.equal(engine.shouldRetry('stream-1', 2000), false);
    });

    it('blocks retries when token budget is exceeded', () => {
      const engine = new FeedbackLoopEngine({ maxRetries: 10, maxCostTokens: 5000 });
      assert.equal(engine.shouldRetry('stream-1', 5001), false);
    });

    it('allows retries for different streams independently', () => {
      const engine = new FeedbackLoopEngine({ maxRetries: 1, maxCostTokens: 500_000 });

      engine.recordIteration({
        iteration: 1, failureKind: 'build_failure', delegatedTo: 'coder',
        streamId: 'stream-A', recoveryStreamId: 'stream-A-recovery-1',
        error: 'build error', resolved: false, tokensBefore: 0,
      });

      // stream-A is exhausted
      assert.equal(engine.shouldRetry('stream-A', 1000), false);
      // stream-B is independent
      assert.equal(engine.shouldRetry('stream-B', 1000), true);
    });
  });

  describe('createRecoveryStream', () => {
    it('creates recovery stream with correct owner for test failures', () => {
      const engine = new FeedbackLoopEngine();
      const original = createMockStream({ id: 'stream-X', name: 'API Changes' });

      const recovery = engine.createRecoveryStream(original, 'test_failure', 'assertion error: expected 1 to equal 2');

      assert.equal(recovery.id, 'stream-X-recovery-1');
      assert.equal(recovery.status, 'pending');
      assert.ok(recovery.name.includes('test_failure'));
      assert.ok(recovery.name.includes('API Changes'));
      assert.ok(recovery.tasks.length > 0);
      assert.ok(recovery.tasks.some(t => t.includes('Investigar')));
    });

    it('creates recovery stream with correct owner for build failures', () => {
      const engine = new FeedbackLoopEngine();
      const original = createMockStream({ id: 'stream-Y' });

      const recovery = engine.createRecoveryStream(original, 'build_failure', 'error TS2304');

      assert.equal(recovery.owner, 'coder');
      assert.ok(recovery.tasks.some(t => t.includes('build') || t.includes('Build')));
    });

    it('creates recovery stream with lint-specific tasks', () => {
      const engine = new FeedbackLoopEngine({ enableAutoLintFix: true });
      const original = createMockStream({ id: 'stream-Z' });

      const recovery = engine.createRecoveryStream(original, 'lint_failure', 'eslint error');

      assert.ok(recovery.tasks.some(t => t.includes('--fix') || t.includes('lint')));
    });

    it('increments recovery ID on successive iterations', () => {
      const engine = new FeedbackLoopEngine();
      const original = createMockStream({ id: 'stream-W' });

      engine.recordIteration({
        iteration: 1, failureKind: 'build_failure', delegatedTo: 'coder',
        streamId: 'stream-W', recoveryStreamId: 'stream-W-recovery-1',
        error: 'build error', resolved: false, tokensBefore: 0,
      });

      const recovery = engine.createRecoveryStream(original, 'build_failure', 'same error');
      assert.equal(recovery.id, 'stream-W-recovery-2');
    });
  });

  describe('getPromptRoleForFailure', () => {
    it('returns debug for test failures', () => {
      const engine = new FeedbackLoopEngine();
      assert.equal(engine.getPromptRoleForFailure('test_failure'), 'debug');
    });

    it('returns coder for build failures', () => {
      const engine = new FeedbackLoopEngine();
      assert.equal(engine.getPromptRoleForFailure('build_failure'), 'coder');
    });
  });

  describe('failure patterns', () => {
    it('accumulates failure patterns with resolution tracking', () => {
      const engine = new FeedbackLoopEngine();

      // Two failures with same signature
      engine.recordIteration({
        iteration: 1, failureKind: 'test_failure', delegatedTo: 'coder',
        streamId: 'stream-1', recoveryStreamId: 'stream-1-recovery-1',
        error: 'assertion error: expected 1 to equal 2', resolved: false, tokensBefore: 0,
      });

      engine.recordIteration({
        iteration: 1, failureKind: 'test_failure', delegatedTo: 'coder',
        streamId: 'stream-2', recoveryStreamId: 'stream-2-recovery-1',
        error: 'assertion error: expected 1 to equal 2', resolved: true, tokensBefore: 0,
        resolvedAt: new Date().toISOString(),
      });

      const patterns = engine.getFailurePatterns();
      assert.equal(patterns.length, 1);
      assert.equal(patterns[0].kind, 'test_failure');
      assert.equal(patterns[0].total, 2);
      assert.equal(patterns[0].resolved, 1);
    });

    it('separates patterns by kind', () => {
      const engine = new FeedbackLoopEngine();

      engine.recordIteration({
        iteration: 1, failureKind: 'test_failure', delegatedTo: 'coder',
        streamId: 'stream-1', recoveryStreamId: 'stream-1-recovery-1',
        error: 'test failed', resolved: false, tokensBefore: 0,
      });

      engine.recordIteration({
        iteration: 1, failureKind: 'build_failure', delegatedTo: 'coder',
        streamId: 'stream-2', recoveryStreamId: 'stream-2-recovery-1',
        error: 'build failed', resolved: false, tokensBefore: 0,
      });

      const patterns = engine.getFailurePatterns();
      assert.equal(patterns.length, 2);
      const kinds = patterns.map(p => p.kind).sort();
      assert.deepEqual(kinds, ['build_failure', 'test_failure']);
    });
  });

  describe('tracing integration', () => {
    it('creates feedback loop spans with correct attributes', async () => {
      const tracing = createTestTracing();

      const span = tracing.startFeedbackLoopSpan('stream-1', 2, 'build_failure');
      span.end();

      const spans = tracing.getFinishedSpans();
      assert.equal(spans.length, 1);
      assert.equal(spans[0].name, 'feedback-loop:build_failure:2');

      const attrs = spans[0].attributes;
      assert.equal(attrs['feedback_loop.stream_id'], 'stream-1');
      assert.equal(attrs['feedback_loop.iteration'], 2);
      assert.equal(attrs['feedback_loop.failure_kind'], 'build_failure');
      assert.equal(attrs['component'], 'feedback-loop');

      await tracing.shutdown();
    });

    it('creates child spans under a parent', async () => {
      const tracing = createTestTracing();

      const parentSpan = tracing.startPhaseSpan('Execution');
      const childSpan = tracing.startFeedbackLoopSpan('stream-1', 1, 'test_failure', parentSpan);

      childSpan.end();
      parentSpan.end();

      const spans = tracing.getFinishedSpans();
      assert.equal(spans.length, 2);

      // Both spans should exist (parent-child relationship is via context)
      const feedbackSpan = spans.find(s => s.name.startsWith('feedback-loop:'));
      assert.ok(feedbackSpan, 'feedback loop span should exist');

      await tracing.shutdown();
    });
  });

  describe('default policy', () => {
    it('has sensible defaults', () => {
      const engine = new FeedbackLoopEngine();
      const policy = engine.getPolicy();

      assert.equal(policy.maxRetries, 3);
      assert.equal(policy.maxCostTokens, 500_000);
      assert.equal(policy.enableAutoLintFix, true);
    });

    it('merges custom policy with defaults', () => {
      const engine = new FeedbackLoopEngine({ maxRetries: 5 });
      const policy = engine.getPolicy();

      assert.equal(policy.maxRetries, 5);
      assert.equal(policy.maxCostTokens, 500_000); // default preserved
    });
  });
});
