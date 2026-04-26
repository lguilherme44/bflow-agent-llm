import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TreeSitterParserService } from '../code/tree-sitter-parser.js';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests', 'fixtures', 'code-samples');

function readFixture(filename: string): string {
  return readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
}

test('Tree-sitter Fixtures - TypeScript', () => {
  const parser = new TreeSitterParserService();
  const code = readFixture('sample.ts');
  const doc = parser.parseText('test.ts', code);
  
  assert.equal(doc.language, 'typescript');
  assert.ok(doc.symbols.some(s => s.kind === 'class' && s.name === 'Service'), 'Should find class');
  assert.ok(doc.symbols.some(s => s.kind === 'method' && s.name === 'execute'), 'Should find method');
  assert.ok(doc.symbols.some(s => s.kind === 'interface' && s.name === 'Data'), 'Should find interface');
});

test('Tree-sitter Fixtures - TSX (React)', () => {
  const parser = new TreeSitterParserService();
  const code = readFixture('sample.tsx');
  const doc = parser.parseText('test.tsx', code);
  
  assert.equal(doc.language, 'tsx');
  assert.ok(doc.symbols.some(s => s.kind === 'arrow_function' && s.name === 'MyComponent'), 'Should find component');
  assert.ok(doc.symbols.some(s => s.kind === 'hook' && s.name === 'useState'), 'Should find useState');
  assert.ok(doc.symbols.some(s => s.kind === 'hook' && s.name === 'useEffect'), 'Should find useEffect');
  assert.ok(doc.symbols.some(s => s.kind === 'jsx_element'), 'Should find JSX element');
});

test('Tree-sitter Fixtures - JavaScript', () => {
  const parser = new TreeSitterParserService();
  const code = readFixture('sample.js');
  const doc = parser.parseText('test.js', code);
  assert.equal(doc.language, 'javascript');
  assert.ok(doc.symbols.some(s => s.kind === 'function' && s.name === 'legacy'), 'Should find function');
});

test('Tree-sitter Fixtures - JSON', () => {
  const parser = new TreeSitterParserService();
  const code = readFixture('sample.json');
  const doc = parser.parseText('test.json', code);
  assert.equal(doc.language, 'json');
  assert.ok(doc.symbols.some(s => s.kind === 'json_property' && s.name === 'name'), 'Should find name property');
  assert.ok(doc.symbols.some(s => s.kind === 'json_property' && s.name === 'config'), 'Should find config property');
});
