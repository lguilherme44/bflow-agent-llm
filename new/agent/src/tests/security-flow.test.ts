import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ReActAgent } from '../agent/react-loop.js';
import { TerminalService } from '../code/terminal-service.js';
import { ContextManager } from '../context/manager.js';
import { MockLLMAdapter } from '../llm/adapter.js';
import { CheckpointManager, FileCheckpointStorage } from '../state/checkpoint.js';
import { ToolRegistry } from '../tools/registry.js';
import { createTool } from '../tools/schema.js';

test('terminal service blocks shell chaining operators', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-terminal-'));
  try {
    const terminal = new TerminalService(workspace);

    await assert.rejects(
      terminal.executeCommand(`node -e "process.stdout.write('SAFE')" && echo HACKED`, '.'),
      /Shell chaining and redirection operators are not allowed/
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('react loop does not mark complete_task as terminal when completion gate fails', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-complete-'));
  try {
    const registry = new ToolRegistry();
    registry.register(
      createTool()
        .name('complete_task')
        .description('Completes the current task after validations pass.')
        .parameters({
          type: 'object',
          properties: {
            status: { type: 'string' },
            summary: { type: 'string' },
          },
          required: ['status', 'summary'],
          additionalProperties: false,
        })
        .handler(async () => ({
          completed: false,
          status: 'failure',
          summary: 'Build validation failed.',
          error: 'Build validation failed.',
        }))
        .build()
    );

    const llm = new MockLLMAdapter();
    llm.setResponses('guarded completion', [
      JSON.stringify({
        thought: 'Vou tentar concluir a tarefa.',
        tool: 'complete_task',
        arguments: { status: 'success', summary: 'Tudo certo.' },
      }),
      JSON.stringify({
        final: {
          status: 'failure',
          summary: 'A conclusao permaneceu bloqueada pela validacao.',
        },
      }),
    ]);

    const checkpointManager = new CheckpointManager(
      new FileCheckpointStorage(path.join(workspace, '.checkpoints'))
    );
    const agent = new ReActAgent({
      llm,
      registry,
      checkpointManager,
      contextManager: new ContextManager(),
      humanApprovalCallback: async () => true,
    });

    const finalState = await agent.run('guarded completion');

    assert.equal(finalState.status, 'error');
    assert.equal(finalState.toolHistory.length, 1);
    assert.match(finalState.metadata.errorMessage ?? '', /bloqueada pela validacao/i);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
