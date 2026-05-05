import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { extractFinalContent } from '../agent/openai-agents/orchestrator.js';

describe('OpenAI orchestrator output extraction', () => {
  it('renders complete_task object output as human summary', () => {
    const content = extractFinalContent({
      finalOutput: {
        completed: true,
        status: 'success',
        summary: 'Criei um Dockerfile otimizado multi-estagio.',
      },
      newItems: [],
    });

    assert.strictEqual(content, 'Criei um Dockerfile otimizado multi-estagio.');
  });

  it('renders complete_task JSON string output as human summary', () => {
    const content = extractFinalContent({
      finalOutput: '{"completed":true,"status":"success","summary":"Arquivos criados com sucesso."}',
      newItems: [],
    });

    assert.strictEqual(content, 'Arquivos criados com sucesso.');
  });
});
