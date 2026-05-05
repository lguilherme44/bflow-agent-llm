const fs = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '..');
const packageJsonPath = require.resolve('tree-sitter/package.json', {
  paths: [workspaceRoot],
});
const bindingPath = path.join(path.dirname(packageJsonPath), 'binding.gyp');

if (!fs.existsSync(bindingPath)) {
  throw new Error(`tree-sitter binding.gyp not found at ${bindingPath}`);
}

const original = fs.readFileSync(bindingPath, 'utf8');
const patched = original
  .replace(/-std=c\+\+17/g, '-std=c++20')
  .replace(/\/std:c\+\+17/g, '/std:c++20')
  .replace(/CLANG_CXX_LANGUAGE_STANDARD": "c\+\+17"/g, 'CLANG_CXX_LANGUAGE_STANDARD": "c++20"');

if (patched !== original) {
  fs.writeFileSync(bindingPath, patched);
  console.log(`[patch-tree-sitter-cxx20] patched ${bindingPath}`);
} else {
  console.log(`[patch-tree-sitter-cxx20] already patched ${bindingPath}`);
}
