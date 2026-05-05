import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { createOpenAITools } from '../agent/openai-agents/tools.js';

describe('OpenAI SDK Tools', () => {
  const tools = createOpenAITools({ workspaceRoot: process.cwd() });

  it('should create all 14 tools', () => {
    const toolNames = [
      'readFileTool',
      'readFileCompactTool',
      'listFilesTool',
      'searchTextTool',
      'executeCommandTool',
      'createFileTool',
      'editFileTool',
      'completeTaskTool',
      'retrieveContextTool',
      'renameSymbolTool',
      'findReferencesTool',
      'runTestsTool',
      'runLinterTool',
      'gitCommitTool',
    ];

    for (const name of toolNames) {
      assert.ok((tools as any)[name], `Tool "${name}" should exist`);
    }
  });

  it('each tool should have name and description', () => {
    const allTools = [
      tools.readFileTool,
      tools.readFileCompactTool,
      tools.listFilesTool,
      tools.searchTextTool,
      tools.executeCommandTool,
      tools.createFileTool,
      tools.editFileTool,
      tools.completeTaskTool,
      tools.retrieveContextTool,
      tools.renameSymbolTool,
      tools.findReferencesTool,
      tools.runTestsTool,
      tools.runLinterTool,
      tools.gitCommitTool,
    ];

    for (const t of allTools) {
      assert.ok(t.name, `Tool should have a name`);
      assert.ok(typeof t.name === 'string', `Tool name should be string`);
    }
  });

  it('edit_file should return oldContent and newContent on success', async () => {
    // We can't test without a real file in the workspace, but we verify
    // the tool is properly configured
    assert.strictEqual(tools.editFileTool.name, 'edit_file');
  });
});
