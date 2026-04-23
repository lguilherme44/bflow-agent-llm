import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { UnifiedLogger } from '../observability/logger.js';
import { ToolResult } from '../types/index.js';

test('UnifiedLogger writes JSONL and redacts secrets', async () => {
  const logDir = path.join(process.cwd(), '.agent', 'logs-test-' + Date.now());
  const logger = new UnifiedLogger({ logDirectory: logDir });

  try {
    const agentId = 'test-agent-123';
    
    logger.logEvent(agentId, 'test_event', { secretData: 'token=superSecret123!' });
    
    // Give it a tiny bit of time to write async
    await new Promise((r) => setTimeout(r, 100));

    const logFile = path.join(logDir, `${agentId}.jsonl`);
    const content = await fs.readFile(logFile, 'utf8');
    const lines = content.trim().split('\n');
    
    assert.strictEqual(lines.length, 1);
    const logEntry = JSON.parse(lines[0]);
    
    assert.strictEqual(logEntry.type, 'event');
    assert.strictEqual(logEntry.agentId, agentId);
    assert.strictEqual(logEntry.payload.event, 'test_event');
    
    // Check redaction
    assert.match(logEntry.payload.secretData as string, /\[REDACTED\]/);
    assert.doesNotMatch(logEntry.payload.secretData as string, /superSecret123!/);

    // Test tool logging
    const mockToolResult: ToolResult = {
      toolCallId: 'call_abc',
      success: true,
      data: { result: 'Bearer mySuperSecretToken' },
      durationMs: 150,
      timestamp: new Date().toISOString(),
      attempts: 1,
      timedOut: false,
      recoverable: false
    };

    logger.logToolExecution(agentId, 'my_tool', 'call_abc', mockToolResult);
    
    await new Promise((r) => setTimeout(r, 100));
    const content2 = await fs.readFile(logFile, 'utf8');
    const lines2 = content2.trim().split('\n');
    
    assert.strictEqual(lines2.length, 2);
    const toolLog = JSON.parse(lines2[1]);
    
    assert.strictEqual(toolLog.type, 'tool');
    assert.strictEqual(toolLog.payload.toolName, 'my_tool');
    assert.strictEqual(toolLog.payload.success, true);
    assert.match(String(toolLog.payload.error), /undefined/); // Because it wasn't defined
  } finally {
    // Cleanup
    await fs.rm(logDir, { recursive: true, force: true });
  }
});
