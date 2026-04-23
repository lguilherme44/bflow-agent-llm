import { TerminalService } from './terminal-service.js';

export class GitService {
  constructor(private readonly terminal: TerminalService) {}

  async createBranch(branchName: string): Promise<void> {
    await this.terminal.executeCommand(`git checkout -b ${branchName}`);
  }

  async commit(message: string): Promise<void> {
    await this.terminal.executeCommand('git add .');
    await this.terminal.executeCommand(`git commit -m "${message}"`);
  }

  async getStatus(): Promise<string> {
    const prefixRes = await this.terminal.executeCommand('git rev-parse --show-prefix');
    const prefix = prefixRes.stdout.trim();

    const result = await this.terminal.executeCommand('git status --porcelain');
    let lines = result.stdout.split('\n');

    if (prefix) {
      lines = lines.map(line => {
        if (line.length < 4) return line;
        const status = line.slice(0, 3);
        const pathPart = line.slice(3);
        // Normalize path separators for comparison
        const normalizedPath = pathPart.replace(/\\/g, '/');
        const normalizedPrefix = prefix.replace(/\\/g, '/');
        
        if (normalizedPath.startsWith(normalizedPrefix)) {
          return status + pathPart.slice(prefix.length);
        }
        return line;
      });
    }

    return lines.join('\n');
  }

  async push(branchName?: string): Promise<void> {
    const cmd = branchName ? `git push origin ${branchName}` : 'git push';
    await this.terminal.executeCommand(cmd);
  }
}
