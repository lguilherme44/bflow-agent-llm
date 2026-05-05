import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs/promises';
import { MCPManager } from '../mcp/mcp-manager.js';

test('MCPManager Integration', async (t) => {
  const testConfigPath = path.join(process.cwd(), 'mcp-test-config.json');
  
  // Criar config de teste apontando para o mock server
  // Usamos tsx para rodar o script TS diretamente
  const config = {
    mcpServers: {
      "mock": {
        "command": "npx",
        "args": ["tsx", "src/tests/mock-mcp-server.ts"]
      }
    }
  };
  
  await fs.writeFile(testConfigPath, JSON.stringify(config));

  const manager = new MCPManager();
  
  await t.test('Should connect and list tools', async () => {
    await manager.loadConfig(testConfigPath);
    await manager.connectAll();
    
    const tools = await manager.getAllTools();
    assert.strictEqual(tools.length, 1);
    assert.strictEqual(tools[0].schema.name, 'mock_echo');
    assert.strictEqual(tools[0].schema.dangerous, true);
  });

  await t.test('Should execute MCP tool', async () => {
    const tools = await manager.getAllTools();
    const echoTool = tools.find(t => t.schema.name === 'mock_echo');
    if (!echoTool) throw new Error('Echo tool not found');

    const result = (await echoTool.execute({ message: 'Hello from test' }, {} as any)) as any;
    assert.ok(result.content, 'Result should have content');
    assert.strictEqual(result.content[0].text, 'Echo: Hello from test');
  });

  // Cleanup
  await manager.shutdown();
  await fs.unlink(testConfigPath);
});
