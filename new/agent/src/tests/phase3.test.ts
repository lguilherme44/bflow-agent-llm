import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MockLLMProvider } from '../llm/providers';
import { LLMRouter } from '../llm/router';
import { redactSecrets } from '../llm/redaction';
import { PromptLibrary } from '../prompts/library';
import { LocalRagService } from '../rag/local-rag';

test('llm router falls back to secondary provider', async () => {
  const failingProvider = new MockLLMProvider([]);
  Object.defineProperty(failingProvider, 'name', { value: 'primary' });
  failingProvider.complete = async () => {
    throw new Error('rate limit');
  };

  const fallbackProvider = new MockLLMProvider([
    JSON.stringify({ final: { status: 'success', summary: 'fallback worked' } }),
  ]);
  Object.defineProperty(fallbackProvider, 'name', { value: 'fallback' });

  const router = new LLMRouter([failingProvider, fallbackProvider], {
    primaryProvider: 'primary',
    fallbackProviders: ['fallback'],
    taskModelPreferences: {},
    timeoutMs: 2_000,
  });

  const response = await router.complete({
    messages: [{ role: 'user', content: 'hello', timestamp: new Date().toISOString() }],
  });

  assert.equal(response.provider, 'fallback');
  assert.equal(response.finalResponse?.summary, 'fallback worked');
});

test('secret redaction removes common credential shapes', () => {
  const redacted = redactSecrets('token=abc123 password=hunter2 Authorization: Bearer supersecretvalue');

  assert.doesNotMatch(redacted, /hunter2/);
  assert.doesNotMatch(redacted, /supersecretvalue/);
  assert.match(redacted, /REDACTED/);
});

test('local rag indexes code and retrieves relevant context with reasons', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'agent-rag-'));
  try {
    await mkdir(path.join(workspace, 'src'), { recursive: true });
    await writeFile(
      path.join(workspace, 'src', 'checkpoint.ts'),
      [
        'export interface CheckpointRecord { id: string }',
        'export function resumeCheckpoint(record: CheckpointRecord) {',
        '  return record.id;',
        '}',
      ].join('\n'),
      'utf8'
    );
    await writeFile(
      path.join(workspace, 'README.md'),
      '# Resume Flow\n\nCheckpoint resume keeps human approval state.',
      'utf8'
    );

    const rag = new LocalRagService(workspace);
    const stats = await rag.indexWorkspace('.');
    const results = rag.retrieve({ task: 'resume checkpoint approval', limit: 3 });

    assert.ok(stats.filesIndexed >= 2);
    assert.ok(results.length > 0);
    assert.ok(results[0].score > 0);
    assert.ok(results[0].reasons.length > 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('prompt library validates structured response contract', () => {
  const library = new PromptLibrary();
  const prompt = library.buildSystemPrompt('planning');

  assert.match(prompt, /AST-first/);
  assert.equal(library.validateStructuredResponse(JSON.stringify({ tool: 'read_file', arguments: {} })).valid, true);
  assert.equal(library.validateStructuredResponse(JSON.stringify({ nope: true })).valid, false);
});
