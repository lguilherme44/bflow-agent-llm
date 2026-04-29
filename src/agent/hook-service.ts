
import { HookAction, HookEvaluation, HookRule, HookType } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { SECURITY_HOOKS } from '../utils/security-hooks.js';

export class HookService {
  private rules: HookRule[] = [];

  constructor(private workspaceRoot: string) {
    // Always load security hooks
    this.rules.push(...SECURITY_HOOKS);
    this.loadRules();
  }

  /**
   * Loads rules from .agent-rules.md if it exists.
   * Format:
   * <!-- hook: rule-id -->
   * ### Rule Name
   * - Type: pre_tool | post_tool
   * - Action: block | warn
   * - Pattern: /regex/
   * - Message: Error message
   * - Tools: read_file, write_file (optional)
   */
  private loadRules(): void {
    const rulesPath = path.join(this.workspaceRoot, '.agent-rules.md');
    if (!fs.existsSync(rulesPath)) {
      return;
    }

    const content = fs.readFileSync(rulesPath, 'utf8');
    const ruleBlocks = content.split(/<!-- hook: /);

    for (const block of ruleBlocks.slice(1)) {
      const id = block.split(' -->')[0];
      const rest = block.split(' -->')[1];

      const typeMatch = rest.match(/- Type: (pre_tool|post_tool)/);
      const actionMatch = rest.match(/- Action: (block|warn)/);
      const patternMatch = rest.match(/- Pattern: \/(.*)\//);
      const messageMatch = rest.match(/- Message: (.*)/);
      const toolsMatch = rest.match(/- Tools: (.*)/);

      if (id && typeMatch && actionMatch && patternMatch && messageMatch) {
        this.rules.push({
          id,
          name: id, // Fallback to ID for name
          description: '',
          type: typeMatch[1] as HookType,
          action: actionMatch[1] as HookAction,
          pattern: patternMatch[1],
          message: messageMatch[1],
          toolFilter: toolsMatch ? toolsMatch[1].split(',').map(s => s.trim()) : undefined
        });
      }
    }
  }

  /**
   * Evaluates a tool call or result against active rules.
   */
  evaluate(type: HookType, toolName: string, payload: any): HookEvaluation[] {
    const evaluations: HookEvaluation[] = [];
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

    for (const rule of this.rules) {
      if (rule.type !== type) continue;
      if (rule.toolFilter && !rule.toolFilter.includes(toolName)) continue;

      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(payloadStr)) {
          evaluations.push({
            ruleId: rule.id,
            action: rule.action,
            message: rule.message,
            triggered: true
          });
        }
      } catch (err) {
        console.error(`Error in hook rule ${rule.id}:`, err);
      }
    }

    return evaluations;
  }

  /**
   * Helper to check if any evaluation blocks execution.
   */
  isBlocked(evaluations: HookEvaluation[]): HookEvaluation | undefined {
    return evaluations.find(e => e.action === 'block');
  }

  /**
   * For testing: manually add a rule.
   */
  addRule(rule: HookRule): void {
    this.rules.push(rule);
  }
}
