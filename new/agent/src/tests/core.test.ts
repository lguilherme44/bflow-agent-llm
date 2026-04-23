import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ReActAgent } from '../agent/react-loop';
import { ContextManager } from '../context/manager';
import { MockLLMAdapter } from '../llm/adapter';
import { CheckpointManager, FileCheckpointStorage } from '../state/checkpoint';
import { AgentStateMachine } from '../state/machine';
import { ToolExecutor } from '../tools/executor';
import { ToolRegistry } from '../tools/registry';
import { createTool } from '../tools/schema';
import { createDevelopmentToolRegistry } from '../tools/development-tools';
import { TreeSitterParserService } from '../code/tree-sitter-parser';

test('state machine validates explicit events', () => {
  const state = AgentStateMachine.create('test task');
  const observing = AgentStateMachine.dispatch(state, { type: 'task_started' });

  assert.equal(observing.status, 'observing');
  assert.throws(() => AgentStateMachine.dispatch(observing, { type: 'tool_call_started' }));
});

test('file checkpoint storage saves, lists and resumes interrupted states', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-checkpoints-'));
  try {
    const manager = new CheckpointManager(new FileCheckpointStorage(directory));
    const state = AgentStateMachine.dispatch(
      AgentStateMachine.dispatch(AgentStateMachine.create('resume me'), { type: 'task_started' }),
      { type: 'thought_started' }
    );

    await manager.checkpoint(state);
    const listed = await manager.list({ taskIncludes: 'resume' });
    const resumed = await manager.resumeFromCheckpoint(state.id, 'unit test');

    assert.equal(listed.length, 1);
    assert.equal(resumed?.status, 'observing');
    assert.match(resumed?.metadata.lastResumeReason ?? '', /interrupted thinking/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('tool executor returns actionable validation errors', async () => {
  const registry = new ToolRegistry();
  registry.register(
    createTool()
      .name('echo_value')
      .description('Echoes a required string value for tests.')
      .parameters({
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      })
      .handler(async (args) => ({ value: args.value }))
      .build()
  );

  const executor = new ToolExecutor(registry, { maxRetries: 3 });
  const result = await executor.execute(AgentStateMachine.create('tool test'), {
    id: 'call-1',
    toolName: 'echo_value',
    arguments: {},
    timestamp: new Date().toISOString(),
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'VALIDATION_ERROR');
  assert.equal(result.attempts, 1);
  assert.match(result.nextActionHint ?? '', /Fix the arguments/);
});

test('tree-sitter parser maps TypeScript structure', () => {
  const parser = new TreeSitterParserService();
  const document = parser.parseText(
    'sample.ts',
    [
      'import { readFile } from "node:fs/promises";',
      'export interface User { name: string }',
      'export function greet(user: User) {',
      '  return user.name;',
      '}',
    ].join('\n')
  );

  assert.equal(document.language, 'typescript');
  assert.equal(document.diagnostics.length, 0);
  assert.ok(document.symbols.some((symbol) => symbol.kind === 'function' && symbol.name === 'greet'));
  assert.ok(document.imports.some((symbol) => symbol.importedFrom === 'node:fs/promises'));
});

test('react loop executes a mock task end to end', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-workspace-'));
  try {
    await writeFile(path.join(workspace, 'index.ts'), 'export const value = 1;\n', 'utf8');

    const registry = createDevelopmentToolRegistry({ workspaceRoot: workspace });
    const checkpointManager = new CheckpointManager(new FileCheckpointStorage(path.join(workspace, '.checkpoints')));
    const llm = new MockLLMAdapter();
    llm.setResponses('read then complete', [
      JSON.stringify({
        thought: 'Read the file first.',
        tool: 'read_file',
        arguments: { filepath: 'index.ts' },
      }),
      JSON.stringify({
        thought: 'The file was inspected.',
        tool: 'complete_task',
        arguments: { status: 'success', summary: 'Inspected index.ts.' },
      }),
    ]);

    const agent = new ReActAgent({
      llm,
      registry,
      checkpointManager,
      contextManager: new ContextManager(),
      humanApprovalCallback: async () => true,
    });

    const finalState = await agent.run('read then complete');
    assert.equal(finalState.status, 'completed');
    assert.equal(finalState.toolHistory.length, 2);
    assert.equal(finalState.toolHistory.at(-1)?.call.toolName, 'complete_task');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('tool executor applies timeout', async () => {
  const registry = new ToolRegistry();
  registry.register(
    createTool()
      .name('slow_tool')
      .description('A tool that simulates a slow operation for testing timeouts.')
      .parameters({ type: 'object', properties: {} })
      .handler(async () => { await new Promise(r => setTimeout(r, 100)); return {}; })
      .timeoutMs(10)
      .build()
  );

  const executor = new ToolExecutor(registry, { maxRetries: 0 });
  const result = await executor.execute(AgentStateMachine.create('timeout test'), {
    id: 'call-timeout',
    toolName: 'slow_tool',
    arguments: {},
    timestamp: new Date().toISOString(),
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'TIMEOUT');
  assert.equal(result.timedOut, true);
});

test('tool executor retries on transient error', async () => {
  const registry = new ToolRegistry();
  let calls = 0;
  registry.register(
    createTool()
      .name('flaky_tool')
      .description('A flaky tool that fails on the first attempt for testing retries.')
      .parameters({ type: 'object', properties: {} })
      .handler(async () => {
        calls++;
        if (calls < 2) throw new Error('Temporary connection error (ECONNRESET)');
        return { success: true };
      })
      .build()
  );

  const executor = new ToolExecutor(registry, { maxRetries: 1, retryBaseDelayMs: 1 });
  const result = await executor.execute(AgentStateMachine.create('retry test'), {
    id: 'call-retry',
    toolName: 'flaky_tool',
    arguments: {},
    timestamp: new Date().toISOString(),
  });

  assert.equal(result.success, true);
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
});

test('tool executor triggers rollback critically', async () => {
  const registry = new ToolRegistry();
  let rolledBack = false;
  registry.register(
    createTool()
      .name('critical_tool')
      .description('A critical tool')
      .parameters({ type: 'object', properties: {} })
      .critical()
      .handler(async () => { throw new Error('Failed midway'); })
      .onRollback(async () => { rolledBack = true; })
      .build()
  );

  const executor = new ToolExecutor(registry, { maxRetries: 0, enableRollback: true });
  const result = await executor.execute(AgentStateMachine.create('rollback test'), {
    id: 'call-rollback',
    toolName: 'critical_tool',
    arguments: {},
    timestamp: new Date().toISOString(),
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'CRITICAL_ERROR');
  assert.equal(rolledBack, true);
  assert.equal(result.rollback?.attempted, true);
});

test('context manager prioritizes touched files and compacts old messages', () => {
  const manager = new ContextManager({ summarizeThreshold: 2, maxMessages: 5 });
  let state = AgentStateMachine.create('context test');
  
  state = manager.addFileContext(state, 'important.ts', 'const x = 1;', 'added');
  state = manager.addFileContext(state, 'less_important.ts', 'const y = 2;', 'added');
  state = manager.markFileTouched(state, 'important.ts', 'touched during work');
  
  assert.ok(state.context.relevantFiles['important.ts'].score > state.context.relevantFiles['less_important.ts'].score);
  
  for (let i = 0; i < 6; i++) {
    state.messages.push({ role: 'assistant', content: `step ${i}`, timestamp: new Date().toISOString() });
  }
  
  const compacted = manager.prepareMessages(state);
  assert.ok(compacted.length <= 6); // System + summary + some non-system based on summary threshold
  assert.ok(compacted.some(m => m.content.includes('important.ts')));
});

