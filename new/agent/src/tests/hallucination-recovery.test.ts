import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ReActAgent } from '../agent/react-loop.js';
import { ContextManager } from '../context/manager.js';
import { MockLLMAdapter } from '../llm/adapter.js';
import { CheckpointManager, FileCheckpointStorage } from '../state/checkpoint.js';
import { createDevelopmentToolRegistry } from '../tools/development-tools.js';

test('repo_browser alias works for list_files and read_file', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-alias-test-'));
  try {
    await writeFile(path.join(workspace, 'test.ts'), 'export const a = 1;\n', 'utf8');

    const registry = createDevelopmentToolRegistry({ workspaceRoot: workspace });
    const checkpointManager = new CheckpointManager(new FileCheckpointStorage(path.join(workspace, '.checkpoints')));
    const llm = new MockLLMAdapter();
    
    // Scenario 1: repo_browser -> list_files
    llm.setResponses('list', [
      JSON.stringify({
        thought: 'Listing files with repo_browser.',
        tool: 'repo_browser',
        arguments: { directory: '.' }
      }),
      JSON.stringify({
        thought: 'Done.',
        tool: 'complete_task',
        arguments: { status: 'success', summary: 'Listed files.' }
      })
    ]);

    const agent = new ReActAgent({
      llm,
      registry,
      checkpointManager,
      contextManager: new ContextManager(),
      humanApprovalCallback: async () => true,
    });

    const state1 = await agent.run('list');
    assert.equal(state1.status, 'completed');
    const firstCall = state1.toolHistory[0];
    assert.equal(firstCall.call.toolName, 'repo_browser');
    assert.ok(firstCall.result.success);
    assert.ok((firstCall.result.data as any).files.includes('test.ts'));

    // Scenario 2: repo_browser -> read_file
    llm.setResponses('read', [
      JSON.stringify({
        thought: 'Reading file with repo_browser.',
        tool: 'repo_browser',
        arguments: { filepath: 'test.ts' }
      }),
      JSON.stringify({
        thought: 'Done.',
        tool: 'complete_task',
        arguments: { status: 'success', summary: 'Read file.' }
      })
    ]);

    const state2 = await agent.run('read');
    assert.equal(state2.status, 'completed');
    const readCall = state2.toolHistory[0];
    assert.ok((readCall.result.data as any).content.includes('export const a = 1'));

  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('repeated TOOL_NOT_FOUND terminates the agent', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-loop-test-'));
  try {
    const registry = createDevelopmentToolRegistry({ workspaceRoot: workspace });
    const checkpointManager = new CheckpointManager(new FileCheckpointStorage(path.join(workspace, '.checkpoints')));
    const llm = new MockLLMAdapter();
    
    // Model keeps calling a non-existent tool 'ghost_tool'
    const ghostCall = JSON.stringify({
      thought: 'Calling ghost tool.',
      tool: 'ghost_tool',
      arguments: {}
    });
    
    llm.setResponses('loop', [ghostCall, ghostCall, ghostCall, ghostCall]);

    const agent = new ReActAgent({
      llm,
      registry,
      checkpointManager,
      contextManager: new ContextManager(),
      humanApprovalCallback: async () => true,
    });

    const finalState = await agent.run('loop');
    
    assert.equal(finalState.status, 'error');
    assert.match(finalState.metadata.errorMessage ?? '', /Repeated failure loop detected/);
    assert.match(finalState.metadata.errorMessage ?? '', /ghost_tool/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('search_text handles empty query gracefully', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-search-test-'));
  try {
    const registry = createDevelopmentToolRegistry({ workspaceRoot: workspace });
    const checkpointManager = new CheckpointManager(new FileCheckpointStorage(path.join(workspace, '.checkpoints')));
    const llm = new MockLLMAdapter();
    
    llm.setResponses('empty search', [
      JSON.stringify({
        thought: 'Searching for nothing.',
        tool: 'search_text',
        arguments: { query: '' }
      }),
      JSON.stringify({
        thought: 'Done.',
        tool: 'complete_task',
        arguments: { status: 'success', summary: 'Search finished.' }
      })
    ]);

    const agent = new ReActAgent({
      llm,
      registry,
      checkpointManager,
      contextManager: new ContextManager(),
      humanApprovalCallback: async () => true,
    });

    const finalState = await agent.run('empty search');
    assert.equal(finalState.status, 'completed');
    const searchCall = finalState.toolHistory[0];
    assert.ok(searchCall.result.success);
    assert.match((searchCall.result.data as any).tip, /query was empty/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('repeated empty responses terminate the agent', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-empty-loop-test-'));
  try {
    const registry = createDevelopmentToolRegistry({ workspaceRoot: workspace });
    const checkpointManager = new CheckpointManager(new FileCheckpointStorage(path.join(workspace, '.checkpoints')));
    const llm = new MockLLMAdapter();
    
    // Model returns empty content and no tools
    const emptyResponse = "";
    
    llm.setResponses('empty loop', [emptyResponse, emptyResponse, emptyResponse, emptyResponse]);

    const agent = new ReActAgent({
      llm,
      registry,
      checkpointManager,
      contextManager: new ContextManager(),
      humanApprovalCallback: async () => true,
    });

    const finalState = await agent.run('empty loop');
    
    assert.equal(finalState.status, 'error');
    assert.match(finalState.metadata.errorMessage ?? '', /IA está retornando respostas vazias repetidamente/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
