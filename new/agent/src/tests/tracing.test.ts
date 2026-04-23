import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ToolCall, ToolResult } from '../types';
import { createTestTracing } from '../observability/tracing';
import { ReActAgent } from '../agent/react-loop';
import { ContextManager } from '../context/manager';
import { MockLLMAdapter } from '../llm/adapter';
import { CheckpointManager, FileCheckpointStorage } from '../state/checkpoint';
import { AgentStateMachine } from '../state/machine';
import { ToolExecutor } from '../tools/executor';
import { ToolRegistry } from '../tools/registry';
import { createTool } from '../tools/schema';
import { createDevelopmentToolRegistry } from '../tools/development-tools';

test('tracing creates spans for tool calls during agent run', async () => {
  const tracing = createTestTracing();
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-trace-'));

  try {
    await writeFile(path.join(workspace, 'hello.ts'), 'export const x = 1;\n', 'utf8');

    const registry = createDevelopmentToolRegistry({ workspaceRoot: workspace });
    const checkpointManager = new CheckpointManager(
      new FileCheckpointStorage(path.join(workspace, '.checkpoints'))
    );
    const llm = new MockLLMAdapter();
    llm.setResponses('trace test', [
      JSON.stringify({
        thought: 'Read the file to inspect.',
        tool: 'read_file',
        arguments: { filepath: 'hello.ts' },
      }),
      JSON.stringify({
        thought: 'Done.',
        tool: 'complete_task',
        arguments: { status: 'success', summary: 'Traced run complete.' },
      }),
    ]);

    const agent = new ReActAgent({
      llm,
      registry,
      checkpointManager,
      contextManager: new ContextManager(),
      tracing,
      humanApprovalCallback: async () => true,
    });

    const finalState = await agent.run('trace test');
    assert.equal(finalState.status, 'completed');

    const spans = tracing.getFinishedSpans();

    // Should have: agent span + 2 LLM spans + 2 tool spans = 5
    const toolSpans = spans.filter((s) => s.name.startsWith('tool:'));
    const llmSpans = spans.filter((s) => s.name.startsWith('llm:'));
    const agentSpans = spans.filter((s) => s.name.startsWith('agent:'));

    assert.ok(toolSpans.length >= 2, `Expected at least 2 tool spans, got ${toolSpans.length}`);
    assert.ok(llmSpans.length >= 2, `Expected at least 2 LLM spans, got ${llmSpans.length}`);
    assert.equal(agentSpans.length, 1, 'Expected exactly 1 agent span');

    // Verify tool span attributes
    const readFileSpan = toolSpans.find((s) => s.name === 'tool:read_file');
    assert.ok(readFileSpan, 'Expected a tool:read_file span');
    assert.equal(readFileSpan.attributes['tool.name'], 'read_file');
    assert.equal(readFileSpan.attributes['tool.success'], true);

    // Verify LLM span attributes
    const firstLlmSpan = llmSpans[0];
    assert.ok(firstLlmSpan.attributes['llm.total_tokens'] !== undefined, 'LLM span should have total_tokens');

    // Verify agent span attributes
    const agentSpan = agentSpans[0];
    assert.equal(agentSpan.attributes['agent.status'], 'completed');
    assert.ok(
      (agentSpan.attributes['agent.tool_calls'] as number) >= 2,
      'Agent span should record tool call count'
    );
  } finally {
    await tracing.shutdown();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('tracing records error status on failed tool', async () => {
  const tracing = createTestTracing();

  try {
    const registry = new ToolRegistry();
    registry.register(
      createTool()
        .name('will_fail')
        .description('A tool that always fails for testing tracing error recording.')
        .parameters({ type: 'object', properties: {} })
        .handler(async () => {
          throw new Error('Intentional failure');
        })
        .build()
    );

    const spanHolder: { span?: import('@opentelemetry/api').Span } = {};

    const executor = new ToolExecutor(
      registry,
      { maxRetries: 0 },
      {
        onToolStart: (toolCall: ToolCall, attempt: number) => {
          if (attempt === 1) {
            spanHolder.span = tracing.startToolSpan(toolCall.toolName, toolCall.id);
          }
        },
        onToolFailure: (_toolCall: ToolCall, result: ToolResult) => {
          if (spanHolder.span) {
            tracing.recordToolResult(spanHolder.span, result);
          }
        },
      }
    );

    await executor.execute(AgentStateMachine.create('fail test'), {
      id: 'call-fail',
      toolName: 'will_fail',
      arguments: {},
      timestamp: new Date().toISOString(),
    });

    const spans = tracing.getFinishedSpans();
    const failSpan = spans.find((s) => s.name === 'tool:will_fail');

    assert.ok(failSpan, 'Expected a tool:will_fail span');
    assert.equal(failSpan.attributes['tool.success'], false);
    assert.equal(failSpan.attributes['tool.error_code'], 'EXECUTION_ERROR');
    assert.ok(failSpan.status.code !== 0, 'Span status should be ERROR');
  } finally {
    await tracing.shutdown();
  }
});

test('tracing in-memory exporter captures LLM spans with usage', async () => {
  const tracing = createTestTracing();

  try {
    const span = tracing.startLLMSpan('openai', 'gpt-4o', 'code');
    tracing.recordLLMUsage(span, {
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700,
    }, 0.0035);

    const spans = tracing.getFinishedSpans();
    assert.equal(spans.length, 1);
    assert.equal(spans[0].attributes['llm.provider'], 'openai');
    assert.equal(spans[0].attributes['llm.model'], 'gpt-4o');
    assert.equal(spans[0].attributes['llm.task_kind'], 'code');
    assert.equal(spans[0].attributes['llm.prompt_tokens'], 500);
    assert.equal(spans[0].attributes['llm.completion_tokens'], 200);
    assert.equal(spans[0].attributes['llm.total_tokens'], 700);
    assert.equal(spans[0].attributes['llm.estimated_cost_usd'], 0.0035);
  } finally {
    await tracing.shutdown();
  }
});
