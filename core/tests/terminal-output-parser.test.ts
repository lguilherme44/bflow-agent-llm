import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalOutputParser } from '../utils/terminal-output-parser.js';

test('TerminalOutputParser - parseTestFailures', () => {
  const stdout = `
▶ AstGrepService - structural search and replace
  ✔ searchInText finds occurrences (1.44ms)
  ✖ createReplacementPlan generates correct patches for API migration (0.58ms)
    AssertionError [ERR_ASSERTION]: Should migrate API
        at TestContext.<anonymous> (file:///C:/Users/Admin/Desktop/server/new/agent/src/tests/ast-grep.test.ts:25:12)
        at Test.runInAsyncScope (node:async_hooks:227:14)
  ✔ createReplacementPlan generates correct patches for adding await (0.97ms)
  ✖ createReplacementPlan generates correct patches for React prop migration (0.49ms)
    Error: Component not found
        at TestContext.<anonymous> (file:///C:/Users/Admin/Desktop/server/new/agent/src/tests/ast-grep.test.ts:45:12)
  ✔ Tree-sitter Fixtures - JSON (1.63ms)
`;
  const stderr = '';

  const failures = TerminalOutputParser.parseTestFailures(stdout, stderr);
  assert.equal(failures.length, 2);
  
  assert.equal(failures[0].testName, 'createReplacementPlan generates correct patches for API migration');
  assert.ok(failures[0].error?.includes('AssertionError'));
  assert.ok(failures[0].location?.includes('ast-grep.test.ts:25'));

  assert.equal(failures[1].testName, 'createReplacementPlan generates correct patches for React prop migration');
  assert.ok(failures[1].error?.includes('Error: Component not found'));
  assert.ok(failures[1].location?.includes('ast-grep.test.ts:45'));
});

test('TerminalOutputParser - parseBuildDiagnostics', () => {
  const stdout = `
src/code/tree-sitter-parser.ts(183,51): error TS7006: Parameter 'c' implicitly has an 'any' type.
src/code/tree-sitter-parser.ts(197,57): error TS7006: Parameter 'c' implicitly has an 'any' type.
`;
  const stderr = '';

  const diagnostics = TerminalOutputParser.parseBuildDiagnostics(stdout, stderr);
  assert.equal(diagnostics.length, 2);

  assert.equal(diagnostics[0].filepath, 'src/code/tree-sitter-parser.ts');
  assert.equal(diagnostics[0].line, 183);
  assert.equal(diagnostics[0].code, 'TS7006');

  assert.equal(diagnostics[1].filepath, 'src/code/tree-sitter-parser.ts');
  assert.equal(diagnostics[1].line, 197);
  assert.equal(diagnostics[1].code, 'TS7006');
});

test('TerminalOutputParser - suggestFiles', () => {
  const failures = [
    { testName: 'T1', location: 'src/test/a.test.ts:10' },
    { testName: 'T2', location: 'src/test/b.test.ts:20' }
  ];
  const suggested = TerminalOutputParser.suggestFiles(failures);
  assert.deepEqual(suggested.sort(), ['src/test/a.test.ts', 'src/test/b.test.ts'].sort());
});
