import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRagService } from '../rag/local-rag.js';
import { TreeSitterParserService } from '../code/tree-sitter-parser.js';

/**
 * RAG Retrieval Benchmark — validates that known queries return expected files.
 *
 * Each test case defines a natural-language question and the file(s) we
 * expect in the top-K results. This acts as a regression gate for the
 * retrieval pipeline.
 */

interface BenchmarkCase {
  query: string;
  expectedFiles: string[];
  k: number;
}

const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    query: 'checkpoint storage save restore file agent state persistence',
    expectedFiles: ['checkpoint'],
    k: 5,
  },
  {
    query: 'RiskPolicyEngine evaluateToolCall risk level blocked high',
    expectedFiles: ['risk-engine'],
    k: 5,
  },
  {
    query: 'TreeSitterParserService parseFileAst tree sitter parser',
    expectedFiles: ['tree-sitter'],
    k: 5,
  },
  {
    query: 'TerminalService executeCommand sandbox terminal command',
    expectedFiles: ['terminal-service'],
    k: 5,
  },
  {
    query: 'ReActAgent observe think act react loop iteration',
    expectedFiles: ['react-loop'],
    k: 8,
  },
  {
    query: 'RankingUtils reciprocal rank fusion rrf hybrid ranking',
    expectedFiles: ['ranking-utils'],
    k: 5,
  },
];

test('RAG Benchmark — known queries return expected files', async () => {
  const parser = new TreeSitterParserService();
  const rag = new LocalRagService(process.cwd(), parser);

  // Index the full src directory
  await rag.indexWorkspace('src');

  const results: Array<{ query: string; hit: boolean; topFiles: string[] }> = [];
  let hits = 0;

  for (const testCase of BENCHMARK_CASES) {
    const retrieved = rag.retrieve({ task: testCase.query, limit: testCase.k });
    const topFiles = retrieved.map((r) => r.chunk.metadata.filepath);

    const hit = testCase.expectedFiles.every((expected) =>
      topFiles.some((filepath) => filepath.includes(expected))
    );

    if (hit) hits++;

    results.push({
      query: testCase.query,
      hit,
      topFiles: topFiles.map((f) => f.split(/[\\/]/).pop() ?? f),
    });
  }

  const hitRate = hits / BENCHMARK_CASES.length;

  // Log benchmark results for analysis
  for (const r of results) {
    const status = r.hit ? '✓' : '✗';
    console.log(`  ${status} "${r.query}" → [${r.topFiles.join(', ')}]`);
  }
  console.log(`  Hit@${BENCHMARK_CASES[0].k} rate: ${(hitRate * 100).toFixed(0)}% (${hits}/${BENCHMARK_CASES.length})`);

  // We require at least 33% hit rate as the minimum quality bar for lexical-only
  // (The vector-search path via retrieveHybrid would score significantly higher)
  assert.ok(
    hitRate >= 0.33,
    `Retrieval hit rate ${(hitRate * 100).toFixed(0)}% is below the 33% minimum threshold`
  );
});

test('RAG Benchmark — retrieval results have valid structure', async () => {
  const parser = new TreeSitterParserService();
  const rag = new LocalRagService(process.cwd(), parser);
  await rag.indexWorkspace('src');

  const results = rag.retrieve({ task: 'agent state machine checkpoint', limit: 5 });

  assert.ok(results.length > 0, 'Should return at least one result');

  for (const result of results) {
    assert.ok(result.score > 0, 'Score must be positive');
    assert.ok(result.reasons.length > 0, 'Must have at least one ranking reason');
    assert.ok(result.chunk.id, 'Chunk must have an ID');
    assert.ok(result.chunk.metadata.filepath, 'Chunk must have a filepath');
    assert.ok(result.chunk.content.length > 0, 'Chunk content must not be empty');
    assert.ok(result.chunk.tokensEstimate > 0, 'Tokens estimate must be positive');
  }
});
