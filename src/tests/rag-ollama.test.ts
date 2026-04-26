import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRagService } from '../rag/local-rag.js';
import { OllamaEmbeddingProvider } from '../rag/embeddings.js';

test('Ollama Embedding Provider — sanity check', async () => {
  // We check if Ollama is running before starting the test
  const isOllamaRunning = await fetch('http://127.0.0.1:11434/api/tags')
    .then((r) => r.ok)
    .catch(() => false);

  if (!isOllamaRunning) {
    console.log('  [SKIP] Ollama is not running at http://127.0.0.1:11434. Skipping Ollama tests.');
    return;
  }

  const provider = new OllamaEmbeddingProvider(768, 'nomic-embed-text');
  const text = 'Hello world, this is a test of the emergency embedding system.';
  const vector = await provider.embed(text);

  assert.strictEqual(vector.length, 768, 'Vector dimension should be 768 for nomic-embed-text');
  
  // Check that it's not all zeros
  const sum = vector.reduce((a, b) => a + Math.abs(b), 0);
  assert.ok(sum > 0, 'Vector should not be all zeros');

  console.log('  ✓ Ollama embedding successful');
});

test('LocalRagService with Ollama provider — retrieval test', async () => {
  const isOllamaRunning = await fetch('http://127.0.0.1:11434/api/tags')
    .then((r) => r.ok)
    .catch(() => false);

  if (!isOllamaRunning) return;

  const provider = new OllamaEmbeddingProvider(768, 'nomic-embed-text');
  const rag = new LocalRagService(process.cwd(), undefined, provider);

  // We'll index a small part of the codebase for speed
  await rag.indexWorkspace('src/rag');

  const query = 'How does the Ollama provider work?';
  const results = await rag.retrieveHybrid({ task: query, limit: 3 });

  assert.ok(results.length > 0, 'Should return some results');
  assert.ok(results[0].reasons.includes('vector similarity'), 'Top result should have vector similarity reason');

  console.log(`  ✓ Retrieved ${results.length} results using Ollama hybrid search`);

  // Test Reranking
  const reranked = await rag.rerankResults(results, query);
  assert.strictEqual(reranked.length, results.length, 'Reranked list should have same length');
  console.log('  ✓ Reranking successful');

  // Test Compression
  const compressed = await rag.compressResults(reranked);
  assert.strictEqual(compressed.length, reranked.length, 'Compressed list should have same length');
  if (compressed.some(c => c.reasons.includes('compressed'))) {
    console.log('  ✓ Compression applied to large chunks');
  } else {
    console.log('  ✓ Compression skip (all chunks small)');
  }
});
