import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { TerminalService } from '../code/terminal-service.js';

describe('TerminalService command policy', () => {
  it('blocks automatic preview commands', async () => {
    const terminal = new TerminalService(process.cwd());

    await assert.rejects(
      () => terminal.executeCommand('npm.cmd run dev', '.'),
      /Command is denied by policy/
    );

    await assert.rejects(
      () => terminal.executeCommand('npx.cmd vite preview', '.'),
      /Command is denied by policy/
    );
  });
});
