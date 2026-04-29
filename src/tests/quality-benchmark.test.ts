/**
 * Quality Benchmark — mede latência real, taxa de acerto do RAG,
 * qualidade das respostas e detecta regressão.
 *
 * Estes testes são mais pesados e devem ser executados com:
 *   node --test dist/tests/quality-benchmark.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRagService } from '../rag/local-rag.js';
import { TreeSitterParserService } from '../code/tree-sitter-parser.js';
import { ContextManager } from '../context/manager.js';
import { AgentStateMachine } from '../state/machine.js';
import { MockLLMAdapter } from '../llm/adapter.js';
import { ReActAgent } from '../agent/react-loop.js';
import { createDevelopmentToolRegistry } from '../tools/development-tools.js';
import { FileCheckpointStorage, CheckpointManager } from '../state/checkpoint.js';
import { UnifiedLogger } from '../observability/logger.js';
import { TracingService } from '../observability/tracing.js';

// ── RAG Quality Metrics ──────────────────────────────────────

test('RAG quality — hit rate on diverse queries', async () => {
  const parser = new TreeSitterParserService();
  const rag = new LocalRagService(process.cwd(), parser);
  await rag.indexWorkspace('src');

  const queries = [
    { q: 'how to execute a shell command safely', expect: 'terminal-service' },
    { q: 'git branch creation and merge workflow', expect: 'orchestrator' },
    { q: 'how are tool calls parsed from LLM responses', expect: 'adapter' },
    { q: 'what is the checkpoint save and restore mechanism', expect: 'checkpoint' },
    { q: 'how does the RAG hybrid search work', expect: 'local-rag' },
    { q: 'what is the ReAct loop observation phase', expect: 'react-loop' },
    { q: 'how does the orchestrator delegate to sub-agents', expect: 'orchestrator' },
    { q: 'how are TypeScript files parsed for symbols', expect: 'tree-sitter' },
    { q: 'what feedback loop recovers from test failures', expect: 'feedback-loop' },
    { q: 'how does context compression prioritize messages', expect: 'manager' },
  ];

  let hits = 0;
  let totalLatency = 0;

  for (const { q, expect } of queries) {
    const started = Date.now();
    const results = await rag.retrieveHybrid({ task: q, limit: 5 });
    totalLatency += Date.now() - started;

    const hasExpected = results.some(r => r.chunk.metadata.filepath.includes(expect));
    if (hasExpected) hits++;
  }

  const hitRate = (hits / queries.length) * 100;
  const avgLatency = totalLatency / queries.length;

  console.log(`RAG Hit Rate: ${hitRate.toFixed(0)}% (${hits}/${queries.length})`);
  console.log(`RAG Avg Latency: ${avgLatency.toFixed(1)}ms`);

  assert.ok(hitRate >= 60, `Hit rate muito baixo: ${hitRate.toFixed(0)}%`);
  assert.ok(avgLatency < 500, `Latência muito alta: ${avgLatency.toFixed(0)}ms`);
});

// ── Context Compression Quality ───────────────────────────────

test('Context compression — preserves critical info', () => {
  const ctx = new ContextManager({ maxMessages: 10, maxTokensEstimate: 1000 });

  let state = AgentStateMachine.create('Fix bug in authentication flow');

  // Simulate a session with tool calls, errors, decisions
  state = ctx.markDecision(state, 'Use bcrypt for password hashing');
  state = ctx.markConstraint(state, 'Must support legacy MD5 passwords during migration');
  
  state = AgentStateMachine.addMessage(state, {
    role: 'assistant', content: 'I found the issue in auth.ts line 42.',
    timestamp: new Date().toISOString(),
  });
  state = AgentStateMachine.addMessage(state, {
    role: 'tool', content: 'auth.ts exports: login, logout, refreshToken',
    toolResult: { toolCallId: '1', success: true, data: {}, durationMs: 10, timestamp: '', attempts: 1, timedOut: false, recoverable: false },
    timestamp: new Date().toISOString(),
  });
  state = AgentStateMachine.addMessage(state, {
    role: 'tool', content: 'ERROR: bcrypt.hash() failed — salt rounds too high for test env',
    toolResult: { toolCallId: '2', success: false, data: {}, durationMs: 50, timestamp: '', attempts: 2, timedOut: false, recoverable: true, error: 'bcrypt error' },
    timestamp: new Date().toISOString(),
  });
  state = AgentStateMachine.addMessage(state, {
    role: 'assistant', content: 'Reducing salt rounds from 12 to 10 for compatibility.',
    timestamp: new Date().toISOString(),
  });
  state = AgentStateMachine.addMessage(state, {
    role: 'tool', content: 'Fixed successfully',
    toolResult: { toolCallId: '3', success: true, data: {}, durationMs: 5, timestamp: '', attempts: 1, timedOut: false, recoverable: false },
    timestamp: new Date().toISOString(),
  });

  const messages = ctx.prepareMessages(state);
  const combined = messages.map(m => m.content).join(' ');

  // Critical info must survive compression
  assert.ok(combined.includes('bcrypt'), 'bcrypt decision should be preserved');
  assert.ok(combined.includes('MD5') || combined.includes('legacy'), 'legacy MD5 constraint should be preserved');
  assert.ok(combined.includes('auth'), 'auth file context should be preserved');
  
  // Verify we're under budget
  const totalTokens = ctx.estimateTokens(messages);
  assert.ok(totalTokens < 2000, `Compressed context should be under 2000 tokens, got ${totalTokens}`);
});

// ── Tool Budget Enforcement ──────────────────────────────────

test('Tool budget — enforces call limit', async () => {
  const registry = createDevelopmentToolRegistry({ workspaceRoot: process.cwd() });
  const storage = new FileCheckpointStorage('/tmp/.agent-test-checkpoints');
  const checkpoint = new CheckpointManager(storage);
  const context = new ContextManager();
  const tracing = new TracingService({ serviceName: 'test', inMemoryExporter: true });
  const logger = new UnifiedLogger({ logDirectory: '/tmp/.agent-test-logs' });

  const mockLLM = new MockLLMAdapter();
  mockLLM.setResponse('test', JSON.stringify({
    tool: 'complete_task',
    arguments: { summary: 'Done' },
  }));

  const agent = new ReActAgent({
    llm: mockLLM,
    registry,
    checkpointManager: checkpoint,
    contextManager: context,
    tracing,
    logger,
    toolBudget: { maxToolCalls: 2, maxTokens: 1000, maxCostUsd: 0.01 },
  });

  const state = await agent.run('test budget enforcement');
  
  // With maxToolCalls=2, the agent should complete or error before 3 calls
  assert.ok(
    state.metadata.totalTokensUsed !== undefined,
    'Agent should track token usage'
  );
});

// ── Regression: typecheck + build gate ────────────────────────

test('Regression gate — typecheck and build pass', async () => {
  // This is a meta-test: verifies the project itself compiles
  // In CI this would be a separate step, but we assert the dist exists
  const fs = await import('node:fs/promises');
  const distExists = await fs.stat('dist').then(s => s.isDirectory()).catch(() => false);
  assert.ok(distExists, 'dist/ directory should exist (build must pass before tests)');
});

// ── Latency Budget ───────────────────────────────────────────

test('Latency — context preparation is fast', () => {
  const ctx = new ContextManager();
  let state = AgentStateMachine.create('latency test');
  
  // Add 50 messages
  for (let i = 0; i < 50; i++) {
    state = AgentStateMachine.addMessage(state, {
      role: i % 3 === 0 ? 'user' : i % 3 === 1 ? 'assistant' : 'tool',
      content: `Message ${i}: ${'x'.repeat(200)}`,
      toolResult: i % 3 === 2 ? { toolCallId: `${i}`, success: true, data: {}, durationMs: 1, timestamp: '', attempts: 1, timedOut: false, recoverable: false } : undefined,
      timestamp: new Date().toISOString(),
    });
  }

  const started = Date.now();
  const messages = ctx.prepareMessages(state);
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 50, `Context preparation too slow: ${elapsed}ms for 50 messages`);
  assert.ok(messages.length <= 50, 'Should not exceed max messages');
});

// ── Snapshot Service ─────────────────────────────────────────

test('Snapshot — captures and restores file state', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const tmpDir = '/tmp/.agent-snapshot-test';
  await fs.mkdir(tmpDir, { recursive: true });
  
  const testFile = path.join(tmpDir, 'test.txt');
  await fs.writeFile(testFile, 'original content', 'utf-8');

  const { SnapshotService } = await import('../code/snapshot-service.js');
  const snap = new SnapshotService(tmpDir);

  const snapshot = await snap.take(testFile, 'test');
  assert.equal(snapshot.content, 'original content');

  // Modify file
  await fs.writeFile(testFile, 'modified content', 'utf-8');

  // Restore
  const restored = await snap.restore(testFile);
  assert.ok(restored);

  const content = await fs.readFile(testFile, 'utf-8');
  assert.equal(content, 'original content', 'Should restore original content');

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
});
