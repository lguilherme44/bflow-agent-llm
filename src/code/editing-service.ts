import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CodeDocument, EditPlan, SourcePosition, SymbolReference } from '../types/index.js';
import { applyTextPatches, assertInsideWorkspace, createUnifiedDiff } from './source.js';
import { AstGrepService } from './ast-grep-service.js';
import { TreeSitterParserService } from './tree-sitter-parser.js';
import { TypeScriptLanguageService } from './typescript-language-service.js';
import { RiskPolicyEngine } from '../utils/risk-engine.js';

export class CodeEditingService {
  private readonly plans = new Map<string, EditPlan>();

  constructor(
    private readonly workspaceRoot = process.cwd(),
    private readonly parser = new TreeSitterParserService(),
    private readonly astGrep = new AstGrepService(),
    private readonly tsService = new TypeScriptLanguageService(workspaceRoot),
    private readonly riskEngine = new RiskPolicyEngine()
  ) {}

  async readFileWithAst(filepath: string): Promise<CodeDocument> {
    const resolved = assertInsideWorkspace(this.workspaceRoot, filepath);
    return this.parser.parseFileAst(resolved);
  }

  async createAstGrepEditPlan(input: {
    filepath: string;
    pattern: string;
    replacement: string;
    description: string;
  }): Promise<EditPlan> {
    const resolved = assertInsideWorkspace(this.workspaceRoot, input.filepath);
    const before = await readFile(resolved, 'utf8');
    const document = this.parser.parseText(resolved, before);
    const replacementPlan = this.astGrep.createReplacementPlan(resolved, before, input.pattern, input.replacement);
    const after = applyTextPatches(before, replacementPlan.patches);
    const diff = createUnifiedDiff(path.relative(this.workspaceRoot, resolved), before, after);
    const syntaxDiagnostics = this.parser.parseText(resolved, after).diagnostics;
    const plan: EditPlan = {
      id: randomUUID(),
      description: input.description,
      filesRead: [resolved],
      filesModified: replacementPlan.patches.length > 0 ? [resolved] : [],
      patches: replacementPlan.patches,
      semanticSummary:
        replacementPlan.patches.length > 0
          ? `Applied structural replacement to ${replacementPlan.patches.length} AST match(es).`
          : 'No structural edit was planned.',
      diff,
      validations: [
        `tree-sitter parsed ${document.language}`,
        `ast-grep structural matches: ${replacementPlan.matches.length}`,
        `post-edit parse diagnostics: ${syntaxDiagnostics.length}`,
      ],
      createdAt: new Date().toISOString(),
      status: 'planned',
      fallback: replacementPlan.fallbackReason
        ? {
            reason: replacementPlan.fallbackReason,
            requiresHumanApproval: true,
            validationStrength: 'reinforced',
          }
        : undefined,
      requiresHumanApproval: Boolean(replacementPlan.fallbackReason),
    };

    this.plans.set(plan.id, plan);
    return plan;
  }

  async createRenamePlan(input: {
    filepath: string;
    position: Pick<SourcePosition, 'line' | 'column'>;
    newName: string;
  }): Promise<EditPlan> {
    const resolved = assertInsideWorkspace(this.workspaceRoot, input.filepath);
    const patches = this.tsService.renameSymbol(resolved, input.position, input.newName);
    const filesModified = Array.from(new Set(patches.map((patch) => patch.filepath)));
    const diffParts: string[] = [];

    for (const file of filesModified) {
      const before = await readFile(file, 'utf8');
      const after = applyTextPatches(before, patches.filter((patch) => patch.filepath === file));
      diffParts.push(createUnifiedDiff(path.relative(this.workspaceRoot, file), before, after));
    }

    const plan: EditPlan = {
      id: randomUUID(),
      description: `Rename symbol at ${input.filepath}:${input.position.line}:${input.position.column} to ${input.newName}`,
      filesRead: [resolved],
      filesModified,
      patches,
      semanticSummary: `TypeScript Language Service planned ${patches.length} rename patch(es).`,
      diff: diffParts.filter(Boolean).join('\n'),
      validations: ['TypeScript rename info resolved', 'references collected by language service'],
      createdAt: new Date().toISOString(),
      status: 'planned',
      requiresHumanApproval: filesModified.length > 3,
      fallback: undefined,
    };

    this.plans.set(plan.id, plan);
    return plan;
  }

  findReferences(filepath: string, position: Pick<SourcePosition, 'line' | 'column'>): SymbolReference[] {
    const resolved = assertInsideWorkspace(this.workspaceRoot, filepath);
    return this.tsService.findReferences(resolved, position);
  }

  async applyEditPlan(planId: string): Promise<EditPlan> {
    const plan = this.getPlan(planId);

    // Evaluate risk for all modified files
    for (const file of plan.filesModified) {
      const evaluation = this.riskEngine.evaluateToolCall('apply_edit_plan', { filepath: path.relative(this.workspaceRoot, file) });
      if (evaluation.level === 'blocked') {
        throw new Error(`Edit blocked by risk policy for file ${file}: ${evaluation.reasons.join(', ')}`);
      }
    }

    if (plan.status !== 'planned') {
      throw new Error(`Edit plan ${planId} is ${plan.status}, expected planned`);
    }

    for (const file of plan.filesModified) {
      const before = await readFile(file, 'utf8');
      const after = applyTextPatches(before, plan.patches.filter((patch) => patch.filepath === file));
      const formatted = this.formatIfNeeded(file, after);
      await writeFile(file, formatted, 'utf8');
      this.parser.clearCache(file);
      this.tsService.updateFile(file, formatted);
    }

    const applied: EditPlan = { ...plan, status: 'applied' };
    this.plans.set(planId, applied);
    return applied;
  }

  async revertEditPlan(planId: string): Promise<EditPlan> {
    const plan = this.getPlan(planId);
    if (plan.status !== 'applied') {
      throw new Error(`Edit plan ${planId} is ${plan.status}, expected applied`);
    }

    const reversePatches = plan.patches.map((patch) => ({
      ...patch,
      oldText: patch.newText,
      newText: patch.oldText,
    }));

    for (const file of plan.filesModified) {
      const before = await readFile(file, 'utf8');
      const after = applyTextPatches(before, reversePatches.filter((patch) => patch.filepath === file));
      const formatted = this.formatIfNeeded(file, after);
      await writeFile(file, formatted, 'utf8');
      this.parser.clearCache(file);
      this.tsService.updateFile(file, formatted);
    }

    const reverted: EditPlan = { ...plan, status: 'reverted' };
    this.plans.set(planId, reverted);
    return reverted;
  }

  async createFile(filepath: string, content: string): Promise<CodeDocument> {
    const evaluation = this.riskEngine.evaluateToolCall('create_file', { filepath });
    if (evaluation.level === 'blocked') {
      throw new Error(`File creation blocked by risk policy: ${evaluation.reasons.join(', ')}`);
    }

    const resolved = assertInsideWorkspace(this.workspaceRoot, filepath);
    await mkdir(path.dirname(resolved), { recursive: true });
    const finalContent = this.formatIfNeeded(resolved, content);
    this.parser.parseText(resolved, finalContent);
    await writeFile(resolved, finalContent, 'utf8');
    this.tsService.updateFile(resolved, finalContent);
    return this.parser.parseText(resolved, finalContent);
  }

  getPlan(planId: string): EditPlan {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Edit plan ${planId} not found`);
    }
    return plan;
  }

  private formatIfNeeded(filepath: string, content: string): string {
    if (filepath.endsWith('.json')) {
      return `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
    }
    return content;
  }
}
