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
