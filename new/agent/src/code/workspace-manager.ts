import path from 'node:path';
import { TerminalService } from './terminal-service.js';

export class WorkspaceManager {
  private readonly storageDir: string;

  constructor(private readonly workspaceRoot: string, private readonly terminal: TerminalService) {
    this.storageDir = path.resolve(workspaceRoot, '.agent-workspaces');
  }

  async createLease(streamId: string): Promise<string> {
    const safeId = this.toSafeId(streamId);
    const leaseDir = path.join(this.storageDir, safeId);
    const branchName = `agent/stream-${safeId}`;
    
    const gitCheck = await this.terminal.execute('git', ['rev-parse', '--is-inside-work-tree']);
    if (gitCheck.exitCode !== 0 || gitCheck.stdout.trim() !== 'true') {
      return this.workspaceRoot;
    }

    await this.terminal.execute('git', ['worktree', 'add', '-b', branchName, leaseDir]);
    return leaseDir;
  }

  async releaseLease(streamId: string, merge = true): Promise<void> {
    const safeId = this.toSafeId(streamId);
    const leaseDir = path.join(this.storageDir, safeId);
    const branchName = `agent/stream-${safeId}`;

    if (leaseDir === this.workspaceRoot) {
      return;
    }

    if (merge) {
      const statusResult = await this.terminal.execute('git', ['status', '--porcelain'], leaseDir);
      if (statusResult.stdout.trim().length > 0) {
        await this.terminal.execute('git', ['add', '.'], leaseDir);
        await this.terminal.execute('git', ['commit', '-m', `agent: stream ${safeId} changes`], leaseDir);
        await this.terminal.execute('git', ['merge', '--no-ff', '--no-edit', branchName], this.workspaceRoot);
      }
    }

    await this.terminal.execute('git', ['worktree', 'remove', leaseDir, '--force']);
    await this.terminal.execute('git', ['branch', '-D', branchName], this.workspaceRoot);
  }

  getWorkspaceFor(streamId: string): string {
    return path.join(this.storageDir, this.toSafeId(streamId));
  }

  private toSafeId(streamId: string): string {
    const safe = streamId.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return safe || 'stream';
  }
}
