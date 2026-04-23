import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AstGrepService } from '../code/ast-grep-service.js';
import { CodeEditingService } from '../code/editing-service.js';
import { assertInsideWorkspace } from '../code/source.js';
import { TerminalService } from '../code/terminal-service.js';
import { GitService } from '../code/git-service.js';
import { TreeSitterParserService } from '../code/tree-sitter-parser.js';
import { TypeScriptLanguageService } from '../code/typescript-language-service.js';
import { LocalRagService } from '../rag/local-rag.js';
import { JsonValue } from '../types/index.js';
import { createTool } from './schema.js';
import { ToolRegistry } from './registry.js';

export interface DevelopmentToolOptions {
  workspaceRoot?: string;
  codeEditingService?: CodeEditingService;
  parserService?: TreeSitterParserService;
  astGrepService?: AstGrepService;
  tsLanguageService?: TypeScriptLanguageService;
  terminalService?: TerminalService;
  ragService?: LocalRagService;
  gitService?: GitService;
}

export function createDevelopmentToolRegistry(options?: DevelopmentToolOptions): ToolRegistry {
  const workspaceRoot = options?.workspaceRoot ?? process.cwd();
  const parser = options?.parserService ?? new TreeSitterParserService();
  const astGrep = options?.astGrepService ?? new AstGrepService();
  const tsService = options?.tsLanguageService ?? new TypeScriptLanguageService(workspaceRoot);
  const editing =
    options?.codeEditingService ?? new CodeEditingService(workspaceRoot, parser, astGrep, tsService);
  const terminal = options?.terminalService ?? new TerminalService(workspaceRoot);
  const rag = options?.ragService ?? new LocalRagService(workspaceRoot, parser);
  const git = options?.gitService ?? new GitService(terminal);
  const registry = new ToolRegistry();

  registry.register(
    createTool()
      .name('complete_task')
      .summary('Finish the current task')
      .description('Marks the current agent task as complete or failed with a concise summary.')
      .whenToUse('Use after verification proves the task is done or cannot continue.')
      .expectedOutput('Completion status and summary.')
      .parameters({
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['success', 'failure'] },
          summary: { type: 'string', minLength: 1 },
        },
        required: ['status', 'summary'],
        additionalProperties: false,
      })
      .example('Complete successfully', { status: 'success', summary: 'Implemented and verified.' })
      .handler(async (args) => {
        if (args.status === 'failure') {
          return { completed: true, status: 'failure', summary: args.summary };
        }

        // Automatic Validation Gate
        try {
          const buildResult = await terminal.executeCommand('npm.cmd run build', '.');
          if (buildResult.exitCode !== 0) {
            return {
              completed: false,
              error: `Build validation failed (exit code ${buildResult.exitCode}). Fix errors before completing.`,
              details: buildResult.stdout + buildResult.stderr
            };
          }

          const lintResult = await terminal.executeCommand('npm.cmd run lint', '.');
          if (lintResult.exitCode !== 0) {
            return {
              completed: false,
              error: `Lint validation failed (exit code ${lintResult.exitCode}). Fix lint issues before completing.`,
              details: lintResult.stdout + lintResult.stderr
            };
          }

          const testResult = await terminal.executeCommand('npm.cmd test', '.');
          if (testResult.exitCode !== 0) {
            return {
              completed: false,
              error: `Test validation failed (exit code ${testResult.exitCode}). Fix failing tests before completing.`,
              details: testResult.stdout + testResult.stderr
            };
          }
        } catch (err: any) {
          return { completed: false, error: `Validation gate error: ${err.message}` };
        }

        return {
          completed: true,
          status: 'success',
          summary: args.summary,
        };
      })
      .build()
  );

  registry.register(
    createTool()
      .name('read_file')
      .summary('Read a file with AST context')
      .description('Reads a workspace file and returns text, AST summary, symbols, imports, exports and diagnostics.')
      .whenToUse('Use before editing or when inspecting a code file.')
      .expectedOutput('File text plus structural information from Tree-sitter.')
      .parameters({
        type: 'object',
        properties: {
          filepath: { type: 'string', minLength: 1 },
        },
        required: ['filepath'],
        additionalProperties: false,
      })
      .example('Read source file', { filepath: 'src/index.ts' })
      .handler(async (args) => editing.readFileWithAst(stringArg(args.filepath, 'filepath')))
      .build()
  );

  registry.register(
    createTool()
      .name('list_files')
      .summary('List workspace files')
      .description('Lists files in the workspace while excluding dependency and build directories.')
      .whenToUse('Use to discover project structure before choosing files to inspect.')
      .expectedOutput('Relative file paths.')
      .parameters({
        type: 'object',
        properties: {
          directory: { type: 'string' },
          extensions: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      })
      .example('List TypeScript files', { directory: '.', extensions: ['.ts', '.tsx'] })
      .handler(async (args) => ({
        files: await listFiles(
          workspaceRoot,
          typeof args.directory === 'string' ? args.directory : '.',
          arrayArg(args.extensions)
        ),
      }))
      .build()
  );

  registry.register(
    createTool()
      .name('search_text')
      .summary('Search text in workspace files')
      .description('Searches workspace files for a literal text query and returns ranked path and line matches.')
      .whenToUse('Use for fast lexical discovery before a structural edit.')
      .expectedOutput('Matching file paths, line numbers and line previews.')
      .parameters({
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1 },
          directory: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      })
      .example('Search for a symbol', { query: 'ReActAgent', directory: 'src' })
      .handler(async (args) => ({
        matches: await searchText(workspaceRoot, stringArg(args.query, 'query'), typeof args.directory === 'string' ? args.directory : '.'),
      }))
      .build()
  );

  registry.register(
    createTool()
      .name('parse_file_ast')
      .summary('Parse a file with Tree-sitter')
      .description('Parses a supported code file with Tree-sitter and returns its structural map.')
      .whenToUse('Use when the agent needs AST-level understanding without reading unrelated files.')
      .expectedOutput('CodeDocument containing AST, symbols, imports, exports and diagnostics.')
      .parameters({
        type: 'object',
        properties: {
          filepath: { type: 'string', minLength: 1 },
        },
        required: ['filepath'],
        additionalProperties: false,
      })
      .example('Parse TSX', { filepath: 'src/App.tsx' })
      .handler(async (args) => parser.parseFileAst(assertInsideWorkspace(workspaceRoot, stringArg(args.filepath, 'filepath'))))
      .build()
  );

  registry.register(
    createTool()
      .name('search_code')
      .summary('Search code lexically and structurally')
      .description('Combines literal text search with optional ast-grep structural search for supported languages.')
      .whenToUse('Use to find code candidates before planning edits.')
      .expectedOutput('Text matches and structural AST matches.')
      .parameters({
        type: 'object',
        properties: {
          query: { type: 'string' },
          structuralPattern: { type: 'string' },
          directory: { type: 'string' },
        },
        additionalProperties: false,
      })
      .example('Find function declarations', { structuralPattern: 'function $NAME($$$ARGS) { $$$BODY }', directory: 'src' })
      .handler(async (args) => {
        const directory = typeof args.directory === 'string' ? args.directory : '.';
        const files = await listFiles(workspaceRoot, directory, ['.ts', '.tsx', '.js', '.jsx']);
        const textMatches = typeof args.query === 'string' ? await searchText(workspaceRoot, args.query, directory) : [];
        const structuralMatches =
          typeof args.structuralPattern === 'string'
            ? await searchStructural(workspaceRoot, files, args.structuralPattern, astGrep)
            : [];
        return { textMatches, structuralMatches };
      })
      .build()
  );

  registry.register(
    createTool()
      .name('retrieve_context')
      .summary('Retrieve ranked project context')
      .description('Indexes the workspace incrementally and retrieves relevant code or documentation chunks using hybrid lexical, structural and recency ranking.')
      .whenToUse('Use before planning or editing so the agent can justify which files matter.')
      .expectedOutput('Ranked context chunks with filepath, score, reasons and metadata.')
      .parameters({
        type: 'object',
        properties: {
          task: { type: 'string', minLength: 1 },
          directory: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
        },
        required: ['task'],
        additionalProperties: false,
      })
      .example('Retrieve context for checkpointing', { task: 'resume checkpoint from awaiting_human', directory: 'src', limit: 5 })
      .handler(async (args) => {
        await rag.indexWorkspace(typeof args.directory === 'string' ? args.directory : '.');
        return {
          results: rag.retrieve({
            task: stringArg(args.task, 'task'),
            limit: typeof args.limit === 'number' ? args.limit : 8,
          }).map((result) => ({
            filepath: result.chunk.metadata.filepath,
            score: result.score,
            reasons: result.reasons,
            symbols: result.chunk.metadata.symbols,
            chunkKind: result.chunk.metadata.chunkKind,
            preview: result.chunk.content.slice(0, 500),
          })),
        };
      })
      .build()
  );

  registry.register(
    createTool()
      .name('edit_file_ast')
      .summary('Plan an AST-first file edit')
      .description('Creates an ast-grep based edit plan without writing files. Apply the plan with apply_edit_plan.')
      .whenToUse('Use when a structural pattern and replacement can express the code change.')
      .expectedOutput('EditPlan with files read, modified files, semantic summary, diff and validations.')
      .parameters({
        type: 'object',
        properties: {
          filepath: { type: 'string', minLength: 1 },
          pattern: { type: 'string', minLength: 1 },
          replacement: { type: 'string' },
          description: { type: 'string', minLength: 1 },
        },
        required: ['filepath', 'pattern', 'replacement', 'description'],
        additionalProperties: false,
      })
      .example('Plan function replacement', {
        filepath: 'src/math.ts',
        pattern: 'function $NAME($$$ARGS) { $$$BODY }',
        replacement: 'async function $NAME($$$ARGS) { $$$BODY }',
        description: 'Convert function to async',
      })
      .handler(async (args) =>
        editing.createAstGrepEditPlan({
          filepath: stringArg(args.filepath, 'filepath'),
          pattern: stringArg(args.pattern, 'pattern'),
          replacement: stringArg(args.replacement, 'replacement'),
          description: stringArg(args.description, 'description'),
        })
      )
      .build()
  );

  registry.register(
    createTool()
      .name('rename_symbol')
      .summary('Plan a TypeScript symbol rename')
      .description('Uses the TypeScript Language Service to plan a safe symbol rename across references.')
      .whenToUse('Use when renaming a TS/TSX/JS symbol by source position.')
      .expectedOutput('EditPlan with TypeScript language-service patches.')
      .parameters({
        type: 'object',
        properties: {
          filepath: { type: 'string', minLength: 1 },
          line: { type: 'integer', minimum: 1 },
          column: { type: 'integer', minimum: 0 },
          newName: { type: 'string', minLength: 1 },
        },
        required: ['filepath', 'line', 'column', 'newName'],
        additionalProperties: false,
      })
      .example('Rename a symbol', { filepath: 'src/index.ts', line: 12, column: 7, newName: 'runAgent' })
      .handler(async (args) =>
        editing.createRenamePlan({
          filepath: stringArg(args.filepath, 'filepath'),
          position: {
            line: numberArg(args.line, 'line'),
            column: numberArg(args.column, 'column'),
          },
          newName: stringArg(args.newName, 'newName'),
        })
      )
      .build()
  );

  registry.register(
    createTool()
      .name('find_references')
      .summary('Find TypeScript references')
      .description('Uses the TypeScript Language Service to find references for a symbol at a source position.')
      .whenToUse('Use before renaming or changing symbol behavior.')
      .expectedOutput('Symbol references with ranges.')
      .parameters({
        type: 'object',
        properties: {
          filepath: { type: 'string', minLength: 1 },
          line: { type: 'integer', minimum: 1 },
          column: { type: 'integer', minimum: 0 },
        },
        required: ['filepath', 'line', 'column'],
        additionalProperties: false,
      })
      .example('Find references', { filepath: 'src/index.ts', line: 12, column: 7 })
      .handler(async (args) =>
        editing.findReferences(stringArg(args.filepath, 'filepath'), {
          line: numberArg(args.line, 'line'),
          column: numberArg(args.column, 'column'),
        })
      )
      .build()
  );

  registry.register(
    createTool()
      .name('apply_edit_plan')
      .summary('Apply a planned edit')
      .description('Writes the patches from an existing EditPlan to disk and updates parser/language-service caches.')
      .whenToUse('Use only after inspecting the edit plan diff and validations.')
      .expectedOutput('Applied EditPlan metadata.')
      .parameters({
        type: 'object',
        properties: {
          planId: { type: 'string', minLength: 1 },
        },
        required: ['planId'],
        additionalProperties: false,
      })
      .dangerous()
      .example('Apply a plan', { planId: 'plan-id' })
      .handler(async (args) => editing.applyEditPlan(stringArg(args.planId, 'planId')))
      .build()
  );

  registry.register(
    createTool()
      .name('revert_edit_plan')
      .summary('Revert an applied edit plan')
      .description('Applies reverse patches for a previously applied EditPlan.')
      .whenToUse('Use when validation fails after an applied code edit.')
      .expectedOutput('Reverted EditPlan metadata.')
      .parameters({
        type: 'object',
        properties: {
          planId: { type: 'string', minLength: 1 },
        },
        required: ['planId'],
        additionalProperties: false,
      })
      .dangerous()
      .example('Revert a plan', { planId: 'plan-id' })
      .handler(async (args) => editing.revertEditPlan(stringArg(args.planId, 'planId')))
      .build()
  );

  registry.register(
    createTool()
      .name('create_file')
      .summary('Create a validated workspace file')
      .description('Creates a new workspace file after path and syntax validation.')
      .whenToUse('Use when the task requires a new file.')
      .expectedOutput('CodeDocument for the created file.')
      .parameters({
        type: 'object',
        properties: {
          filepath: { type: 'string', minLength: 1 },
          content: { type: 'string' },
        },
        required: ['filepath', 'content'],
        additionalProperties: false,
      })
      .dangerous()
      .example('Create a file', { filepath: 'src/new-file.ts', content: 'export const value = 1;\\n' })
      .handler(async (args) => editing.createFile(stringArg(args.filepath, 'filepath'), stringArg(args.content, 'content')))
      .build()
  );

  registry.register(
    createTool()
      .name('write_file')
      .summary('Write a validated workspace file')
      .description('Writes a workspace file after path and syntax validation, then refreshes AST and TypeScript caches.')
      .whenToUse('Use only when a direct full-file write is safer than a patch plan, such as creating generated fixtures.')
      .whenNotToUse('Do not use for code refactors that can be expressed as AST edit plans.')
      .expectedOutput('CodeDocument for the written file.')
      .parameters({
        type: 'object',
        properties: {
          filepath: { type: 'string', minLength: 1 },
          content: { type: 'string' },
        },
        required: ['filepath', 'content'],
        additionalProperties: false,
      })
      .dangerous()
      .example('Write a file', { filepath: 'src/generated.ts', content: 'export const generated = true;\\n' })
      .handler(async (args) => editing.createFile(stringArg(args.filepath, 'filepath'), stringArg(args.content, 'content')))
      .build()
  );

  registry.register(
    createTool()
      .name('run_command')
      .summary('Run a guarded terminal command')
      .description('Executes an allowed command in the workspace with timeout, output limits and secret redaction.')
      .whenToUse('Use for validation commands such as typecheck, tests or git status.')
      .expectedOutput('Exit code, duration and redacted output.')
      .parameters({
        type: 'object',
        properties: {
          command: { type: 'string', minLength: 1 },
          cwd: { type: 'string' },
        },
        required: ['command'],
        additionalProperties: false,
      })
      .dangerous()
      .example('Run typecheck', { command: 'npm.cmd run typecheck', cwd: '.' })
      .handler(async (args) =>
        terminal.executeCommand(stringArg(args.command, 'command'), typeof args.cwd === 'string' ? args.cwd : '.')
      )
      .build()
  );

  registry.register(
    createTool()
      .name('execute_command')
      .summary('Execute a guarded terminal command')
      .description('Executes an allowed command in the workspace with timeout, output limits and secret redaction.')
      .whenToUse('Use for validation commands when a specific shell command is required.')
      .expectedOutput('Exit code, duration and redacted output.')
      .parameters({
        type: 'object',
        properties: {
          command: { type: 'string', minLength: 1 },
          cwd: { type: 'string' },
        },
        required: ['command'],
        additionalProperties: false,
      })
      .dangerous()
      .example('Run typecheck', { command: 'npm.cmd run typecheck', cwd: '.' })
      .handler(async (args) =>
        terminal.executeCommand(stringArg(args.command, 'command'), typeof args.cwd === 'string' ? args.cwd : '.')
      )
      .build()
  );

  registry.register(
    createTool()
      .name('run_tests')
      .summary('Run project tests')
      .description('Runs the configured npm test command through the guarded terminal service.')
      .whenToUse('Use after code changes or when reproducing failures.')
      .expectedOutput('Command result with parsed output for failures.')
      .parameters({ type: 'object', properties: {}, additionalProperties: false })
      .dangerous()
      .example('Run tests', {})
      .handler(async () => terminal.executeCommand('npm.cmd test', '.'))
      .build()
  );

  registry.register(
    createTool()
      .name('run_build')
      .summary('Run project build')
      .description('Runs the configured npm build command through the guarded terminal service.')
      .whenToUse('Use before accepting a task that changes TypeScript code.')
      .expectedOutput('Command result and build diagnostics output.')
      .parameters({ type: 'object', properties: {}, additionalProperties: false })
      .dangerous()
      .example('Run build', {})
      .handler(async () => terminal.executeCommand('npm.cmd run build', '.'))
      .build()
  );

  registry.register(
    createTool()
      .name('run_linter')
      .summary('Run project linter')
      .description('Runs npm lint when configured through the guarded terminal service.')
      .whenToUse('Use after formatting-sensitive code changes when lint exists.')
      .expectedOutput('Command result and lint diagnostics output.')
      .parameters({ type: 'object', properties: {}, additionalProperties: false })
      .dangerous()
      .example('Run linter', {})
      .handler(async () => terminal.executeCommand('npm.cmd run lint', '.'))
      .build()
  );

  registry.register(
    createTool()
      .name('install_dependency')
      .summary('Install an npm dependency')
      .description('Installs an npm package and records command output. This always requires human approval.')
      .whenToUse('Use only when a dependency is necessary and approved.')
      .expectedOutput('Command result and updated dependency metadata.')
      .parameters({
        type: 'object',
        properties: {
          packageName: { type: 'string', minLength: 1 },
          dev: { type: 'boolean' },
        },
        required: ['packageName'],
        additionalProperties: false,
      })
      .dangerous()
      .example('Install a dev dependency', { packageName: 'tsx', dev: true })
      .handler(async (args) => {
        const packageName = packageArg(args.packageName);
        const flag = args.dev === true ? '--save-dev' : '';
        return terminal.executeCommand(`npm.cmd install ${flag} ${packageName}`.trim(), '.');
      })
      .build()
  );

  registry.register(
    createTool()
      .name('git_create_branch')
      .summary('Create a new git branch')
      .description('Creates and switches to a new git branch for a feature or bugfix.')
      .whenToUse('Use at the start of a new task to isolate changes.')
      .expectedOutput('Success message or error.')
      .parameters({
        type: 'object',
        properties: {
          branchName: { type: 'string', minLength: 1 },
        },
        required: ['branchName'],
        additionalProperties: false,
      })
      .dangerous()
      .example('Create branch', { branchName: 'feature/new-agent-ui' })
      .handler(async (args) => {
        await git.createBranch(stringArg(args.branchName, 'branchName'));
        return { message: `Branch ${args.branchName} created and checked out.` };
      })
      .build()
  );

  registry.register(
    createTool()
      .name('git_commit')
      .summary('Commit workspace changes')
      .description('Adds all changes and commits them with a descriptive message following Conventional Commits.')
      .whenToUse('Use after completing a logical unit of work.')
      .expectedOutput('Commit confirmation.')
      .parameters({
        type: 'object',
        properties: {
          message: { type: 'string', minLength: 1 },
        },
        required: ['message'],
        additionalProperties: false,
      })
      .dangerous()
      .example('Commit changes', { message: 'feat: add human approval UI to TUI' })
      .handler(async (args) => {
        await git.commit(stringArg(args.message, 'message'));
        return { message: 'Changes committed successfully.' };
      })
      .build()
  );

  registry.register(
    createTool()
      .name('git_status')
      .summary('Get git status')
      .description('Returns the current git status in porcelain format.')
      .whenToUse('Use to see modified or untracked files.')
      .expectedOutput('Porcelain status output.')
      .parameters({ type: 'object', properties: {}, additionalProperties: false })
      .handler(async () => ({ status: await git.getStatus() }))
      .build()
  );

  return registry;
}

function stringArg(value: JsonValue | undefined, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function numberArg(value: JsonValue | undefined, name: string): number {
  if (typeof value !== 'number') {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

function arrayArg(value: JsonValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function packageArg(value: JsonValue | undefined): string {
  const packageName = stringArg(value, 'packageName');
  if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+(@[a-z0-9_.-]+)?$/i.test(packageName)) {
    throw new Error('packageName contains unsupported characters');
  }
  return packageName;
}

async function listFiles(workspaceRoot: string, directory: string, extensions?: string[]): Promise<string[]> {
  const root = assertInsideWorkspace(workspaceRoot, directory);
  const output: string[] = [];
  const ignored = new Set(['node_modules', 'dist', '.git', '.agent', '.agent-checkpoints', 'build', 'out']);

  async function walk(current: string): Promise<void> {
    if (output.length > 500) return; // Limite de segurança para evitar flood de contexto

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (ignored.has(entry.name) || entry.name.startsWith('.')) {
        if (entry.name !== '.env' && entry.name !== '.gitignore') {
          continue;
        }
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (!extensions || extensions.includes(path.extname(entry.name))) {
        output.push(path.relative(workspaceRoot, fullPath));
      }
    }
  }

  await walk(root);
  return output.sort().slice(0, 500);
}

async function searchText(workspaceRoot: string, query: string, directory: string): Promise<Array<Record<string, JsonValue>>> {
  const files = await listFiles(workspaceRoot, directory);
  const matches: Array<Record<string, JsonValue>> = [];

  for (const relativePath of files) {
    const fullPath = assertInsideWorkspace(workspaceRoot, relativePath);
    const content = await readFile(fullPath, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.includes(query)) {
        matches.push({
          filepath: relativePath,
          line: index + 1,
          preview: line.trim().slice(0, 240),
        });
      }
    });
  }

  return matches.slice(0, 100);
}

async function searchStructural(
  workspaceRoot: string,
  files: string[],
  structuralPattern: string,
  astGrep: AstGrepService
): Promise<Array<Record<string, JsonValue>>> {
  const matches: Array<Record<string, JsonValue>> = [];

  for (const relativePath of files) {
    const fullPath = assertInsideWorkspace(workspaceRoot, relativePath);
    const content = await readFile(fullPath, 'utf8');
    for (const match of astGrep.searchInText(relativePath, content, structuralPattern)) {
      matches.push({
        filepath: match.filepath,
        kind: match.kind,
        text: match.text.slice(0, 240),
        line: match.range.start.line,
        column: match.range.start.column,
      });
    }
  }

  return matches.slice(0, 100);
}
