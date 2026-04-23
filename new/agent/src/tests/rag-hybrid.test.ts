import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRagService } from '../rag/local-rag.js';
import { TreeSitterParserService } from '../code/tree-sitter-parser.js';

test('LocalRagService - hybrid retrieval', async () => {
  const parser = new TreeSitterParserService();
  const rag = new LocalRagService(process.cwd(), parser);
  
  // Index the rag directory
  await rag.indexWorkspace('src/rag');
  
  const results = rag.retrieve({
    task: 'RankingUtils rrf reciprocal rank fusion',
    limit: 5
  });
  
  assert.ok(results.length > 0, 'Should return some results');
  assert.ok(results[0].score > 0, 'Top result should have a positive score');
  assert.ok(results[0].reasons.length > 0, 'Should have ranking reasons');
  
  // Check if ranking-utils.ts is found in any result
  const rankingMatch = results.find(r => r.chunk.metadata.filepath.includes('ranking-utils'));
  assert.ok(rankingMatch, 'Should find ranking-utils.ts in results');
});

test('LocalRagService - filters', async () => {
  const parser = new TreeSitterParserService();
  const rag = new LocalRagService(process.cwd(), parser);
  await rag.indexWorkspace('src/rag');
  
  const results = rag.retrieve({
    task: 'ranking',
    filters: {
      languages: ['typescript'],
      filepaths: ['ranking-utils.ts']
    }
  });
  
  for (const res of results) {
    assert.equal(res.chunk.metadata.language, 'typescript');
    assert.ok(res.chunk.metadata.filepath.endsWith('ranking-utils.ts'));
  }
});
