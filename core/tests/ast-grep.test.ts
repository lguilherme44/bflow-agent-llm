import test from 'node:test';
import assert from 'node:assert/strict';
import { AstGrepService } from '../code/ast-grep-service.js';

test('AstGrepService - structural search and replace', async (t) => {
  const service = new AstGrepService();

  await t.test('searchInText finds occurrences', () => {
    const code = 'const x = 1; const y = 2;';
    const matches = service.searchInText('test.ts', code, 'const $VAR = $VAL');
    assert.equal(matches.length, 2);
    assert.equal(matches[0].text, 'const x = 1;');
  });

  await t.test('createReplacementPlan generates correct patches for API migration', () => {
    const beforeCode = `
      import { legacyApi } from './api';
      legacyApi.doSomething(1, 2);
    `;
    const plan = service.createReplacementPlan(
      'test.ts',
      beforeCode,
      'legacyApi.doSomething($$$ARGS)',
      'newApi.performAction($$$ARGS)'
    );

    assert.equal(plan.patches.length, 1);
    assert.equal(plan.patches[0].oldText, 'legacyApi.doSomething(1, 2)');
    assert.equal(plan.patches[0].newText, 'newApi.performAction(1, 2)');
  });

  await t.test('createReplacementPlan generates correct patches for adding await', () => {
    const beforeCode = `
      async function main() {
        const result = oldSyncMethod(123);
        return result;
      }
    `;
    const plan = service.createReplacementPlan(
      'test.ts',
      beforeCode,
      'oldSyncMethod($$$ARGS)',
      'await oldSyncMethod($$$ARGS)'
    );

    assert.equal(plan.patches.length, 1);
    assert.equal(plan.patches[0].oldText, 'oldSyncMethod(123)');
    assert.equal(plan.patches[0].newText, 'await oldSyncMethod(123)');
  });

  await t.test('createReplacementPlan generates correct patches for React prop migration', () => {
    const beforeCode = `const App = () => <Button oldProp={true} label="Click" />;`;
    const plan = service.createReplacementPlan(
      'app.tsx',
      beforeCode,
      '<Button oldProp={$VAL} $$$REST />',
      '<Button newProp={$VAL} $$$REST />'
    );

    assert.equal(plan.patches.length, 1);
    assert.equal(plan.patches[0].newText, '<Button newProp={true} label="Click" />');
  });

  await t.test('createReplacementPlan generates correct patches for import renaming', () => {
    const beforeCode = `import { legacyFunc } from 'old-library';`;
    const plan = service.createReplacementPlan(
      'index.ts',
      beforeCode,
      "import { $FUNC } from 'old-library'",
      "import { $FUNC } from 'new-library'"
    );

    assert.equal(plan.patches.length, 1);
    assert.equal(plan.patches[0].newText, "import { legacyFunc } from 'new-library'");
  });
});
