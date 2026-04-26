import path from 'path';
import { JsonValue } from '../types/index.js';

export type RiskLevel = 'low' | 'medium' | 'high' | 'blocked';

export interface RiskEvaluation {
  level: RiskLevel;
  score: number;
  reasons: string[];
}

export class RiskPolicyEngine {
  private readonly sensitiveFiles = [
    /\.env$/,
    /\.git([\\/]|$)/,
    /node_modules([\\/]|$)/,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /\.agentrc$/,
    /secrets([\\/]|$)/,
  ];

  private readonly dangerousCommands = [
    { pattern: /\brm\s+-rf\s+\//i, level: 'blocked', reason: 'Attempt to delete root directory' },
    { pattern: /\bformat\b/i, level: 'high', reason: 'Formatting disks is dangerous' },
    { pattern: /\bdel\s+\/s\b/i, level: 'high', reason: 'Recursive deletion' },
    { pattern: /\bdrop\s+database\b/i, level: 'blocked', reason: 'Database destruction' },
    { pattern: /\bshutdown\b/i, level: 'blocked', reason: 'System shutdown' },
    { pattern: /curl\s+\S+\s+\|\s+sh/i, level: 'high', reason: 'Executing remote scripts' },
    { pattern: /\bgit\s+reset\s+--hard\b/i, level: 'blocked', reason: 'Hard reset discards local changes' },
    { pattern: /\bgit\s+clean\s+-f/i, level: 'blocked', reason: 'Git clean removes untracked files' },
    { pattern: /\bgit\s+push\b.*\s--force\b/i, level: 'high', reason: 'Force-pushing can overwrite remote history' },
    { pattern: /(&&|\|\||;)/, level: 'high', reason: 'Shell command chaining increases execution risk' },
  ];

  constructor(private readonly workspaceRoot: string = process.cwd()) {}

  evaluateToolCall(toolName: string, args: Record<string, JsonValue>): RiskEvaluation {
    const reasons: string[] = [];
    let score = 0;

    // Evaluate based on tool name
    if (['run_command', 'execute_command', 'run_tests', 'run_build', 'run_linter', 'install_dependency'].includes(toolName)) {
      score += 30;
      reasons.push(`Tool '${toolName}' executes terminal commands`);
    }

    if (['write_file', 'create_file', 'apply_edit_plan'].includes(toolName)) {
      score += 20;
      reasons.push(`Tool '${toolName}' modifies the filesystem`);
    }

    // Evaluate arguments
    const filepath = args.filepath || args.path || args.targetFile || args.TargetFile;
    if (typeof filepath === 'string') {
      const normalizedWorkspace = path.resolve(this.workspaceRoot);
      const fullPath = path.resolve(normalizedWorkspace, filepath);
      const normalizedFilepath = filepath.replace(/\\/g, '/');
      
      if (!fullPath.startsWith(normalizedWorkspace)) {
        return { level: 'blocked', score: 100, reasons: [`Path outside workspace: ${filepath}`] };
      }

      const isSensitive = this.sensitiveFiles.some((pattern) => pattern.test(normalizedFilepath));
      if (isSensitive) {
        score += 50;
        reasons.push(`Accessing sensitive file: ${filepath}`);
      }
    }

    if (typeof args.command === 'string') {
      for (const cmdPolicy of this.dangerousCommands) {
        if (cmdPolicy.pattern.test(args.command)) {
          if (cmdPolicy.level === 'blocked') {
            return { level: 'blocked', score: 100, reasons: [cmdPolicy.reason] };
          }
          score += 60;
          reasons.push(cmdPolicy.reason);
        }
      }
    }

    // Determine level based on score
    let level: RiskLevel = 'low';
    if (score >= 70) level = 'high';
    else if (score >= 30) level = 'medium';

    return { level, score, reasons };
  }
}
