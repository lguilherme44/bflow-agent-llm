import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { listFiles, searchText } from '../utils/file-utils.js';
import path from 'node:path';

const workspaceRoot = path.resolve(process.cwd());

describe('file-utils', () => {
  describe('listFiles', () => {
    it('should list files from a directory', async () => {
      const files = await listFiles(workspaceRoot, '.');
      assert.ok(Array.isArray(files), 'Should return an array');
      assert.ok(files.length > 0, 'Should find files in the workspace');
    });

    it('should filter by extensions', async () => {
      const tsFiles = await listFiles(workspaceRoot, '.', ['.ts']);
      assert.ok(tsFiles.length > 0, 'Should find .ts files');
      for (const file of tsFiles) {
        assert.ok(file.endsWith('.ts'), `File ${file} should end with .ts`);
      }
    });

    it('should exclude node_modules and dist', async () => {
      const files = await listFiles(workspaceRoot, '.');
      for (const file of files) {
        assert.ok(!file.includes('node_modules'), `Should not include node_modules: ${file}`);
        assert.ok(!file.startsWith('dist/'), `Should not include dist/: ${file}`);
      }
    });

    it('should cap results at 500', async () => {
      const files = await listFiles(workspaceRoot, '.');
      assert.ok(files.length <= 500, 'Should not exceed 500 files');
    });

    it('should reject paths outside workspace', async () => {
      await assert.rejects(
        () => listFiles(workspaceRoot, '../../etc'),
        /outside workspace/i,
        'Should throw for paths outside workspace'
      );
    });
  });

  describe('searchText', () => {
    it('should find text matches in files', async () => {
      const matches = await searchText(workspaceRoot, 'export', '.');
      assert.ok(Array.isArray(matches), 'Should return an array');
      assert.ok(matches.length > 0, 'Should find "export" in source files');
    });

    it('should include filepath, line and preview in results', async () => {
      const matches = await searchText(workspaceRoot, 'AgentRunner', '.');
      if (matches.length > 0) {
        const first = matches[0];
        assert.ok('filepath' in first, 'Should have filepath');
        assert.ok('line' in first, 'Should have line number');
        assert.ok('preview' in first, 'Should have preview');
      }
    });

    it('should cap results at 100', async () => {
      const matches = await searchText(workspaceRoot, 'const', '.');
      assert.ok(matches.length <= 100, 'Should not exceed 100 matches');
    });
  });
});
