import { TerminalService } from './terminal-service.js';

export interface GitFileStatus {
  filepath: string;
  status: string;
}

export class GitService {
  constructor(private readonly terminal: TerminalService) {}

  async createBranch(branchName: string): Promise<void> {
    await this.terminal.execute('git', ['checkout', '-b', branchName]);
  }

  async commit(message: string): Promise<void> {
    await this.terminal.execute('git', ['add', '.']);
    await this.terminal.execute('git', ['commit', '-m', message]);
  }

  async getStatus(): Promise<string> {
    const result = await this.terminal.execute('git', ['status', '--porcelain']);
    const lines = await this.normalizePorcelainLines(result.stdout);
    return lines.join('\n');
  }

  async getParsedStatus(): Promise<GitFileStatus[]> {
    const result = await this.terminal.execute('git', ['status', '--porcelain']);
    const lines = await this.normalizePorcelainLines(result.stdout);
    
    return lines
      .filter(line => line.length >= 4)
      .map(line => ({
        status: line.slice(0, 2),
        filepath: line.slice(3).trim()
      }));
  }

  private async normalizePorcelainLines(stdout: string): Promise<string[]> {
    const prefixRes = await this.terminal.execute('git', ['rev-parse', '--show-prefix']);
    const prefix = prefixRes.stdout.trim();
    let lines = stdout.split('\n').filter(l => l.trim().length > 0);

    if (prefix) {
      lines = lines.map(line => {
        if (line.length < 4) return line;
        const status = line.slice(0, 3);
        const pathPart = line.slice(3);
        const normalizedPath = pathPart.replace(/\\/g, '/');
        const normalizedPrefix = prefix.replace(/\\/g, '/');
        
        if (normalizedPath.startsWith(normalizedPrefix)) {
          return status + pathPart.slice(prefix.length);
        }
        return line;
      });
    }
    return lines;
  }

  async push(branchName?: string): Promise<void> {
    const args = branchName ? ['push', 'origin', branchName] : ['push'];
    await this.terminal.execute('git', args);
  }
}
