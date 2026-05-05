import { tool } from '@openai/agents';
import { z } from 'zod';
import { DevelopmentToolOptions, listFiles, searchText } from '../../utils/file-utils.js';
import { TreeSitterParserService } from '../../code/tree-sitter-parser.js';
import { AstGrepService } from '../../code/ast-grep-service.js';
import { TypeScriptLanguageService } from '../../code/typescript-language-service.js';
import { CodeEditingService } from '../../code/editing-service.js';
import { TerminalService } from '../../code/terminal-service.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LocalRagService } from '../../rag/local-rag.js';
import { GitService, GitFileStatus } from '../../code/git-service.js';
import { TerminalOutputParser } from '../../utils/terminal-output-parser.js';

export function createOpenAITools(options?: DevelopmentToolOptions) {
  const workspaceRoot = options?.workspaceRoot ?? process.cwd();
  const parser = options?.parserService ?? new TreeSitterParserService();
  const astGrep = options?.astGrepService ?? new AstGrepService();
  const tsService = options?.tsLanguageService ?? new TypeScriptLanguageService(workspaceRoot);
  const editing = options?.codeEditingService ?? new CodeEditingService(workspaceRoot, parser, astGrep, tsService);
  const terminal = options?.terminalService ?? new TerminalService(workspaceRoot);
  const rag = options?.ragService ?? new LocalRagService(workspaceRoot, parser);
  const git = options?.gitService ?? new GitService(terminal);

  // ── read_file (completo com AST) ─────────────────────────────
  const readFileTool = tool({
    name: 'read_file',
    description: 'Reads a file with AST analysis: text, symbols, imports, exports, diagnostics. Use for deep analysis.',
    parameters: z.object({
      filepath: z.string().min(1).describe('Relative path to the file'),
    }),
    execute: async ({ filepath }: { filepath: string }) => editing.readFileWithAst(filepath),
  });

  // ── read_file_compact (leve, só texto) ──────────────────────
  // Economiza tokens em modelos com context limitado
  const readFileCompactTool = tool({
    name: 'read_file_compact',
    description: 'Reads ONLY the raw text content of a file. Lighter than read_file — use when you just need the code.',
    parameters: z.object({
      filepath: z.string().min(1).describe('Relative path to the file'),
      startLine: z.number().int().min(1).optional().describe('First line to read (1-indexed)'),
      endLine: z.number().int().min(1).optional().describe('Last line to read (1-indexed)'),
    }),
    execute: async ({ filepath, startLine, endLine }: { filepath: string; startLine?: number; endLine?: number }) => {
      const resolved = path.resolve(workspaceRoot, filepath);
      // Segurança: impedir leitura fora do workspace
      if (!resolved.startsWith(path.resolve(workspaceRoot))) {
        return { error: 'Path is outside the workspace.' };
      }
      const content = await readFile(resolved, 'utf8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      if (startLine || endLine) {
        const start = Math.max(1, startLine ?? 1);
        const end = Math.min(totalLines, endLine ?? totalLines);
        const slice = lines.slice(start - 1, end);
        return {
          filepath,
          totalLines,
          range: `${start}-${end}`,
          content: slice.join('\n'),
        };
      }

      // Se o arquivo for grande, truncar para economizar contexto
      const MAX_LINES = 300;
      if (totalLines > MAX_LINES) {
        return {
          filepath,
          totalLines,
          truncated: true,
          content: lines.slice(0, MAX_LINES).join('\n'),
          note: `Showing first ${MAX_LINES} of ${totalLines} lines. Use startLine/endLine to read specific ranges.`,
        };
      }

      return { filepath, totalLines, content };
    },
  });

  // ── list_files ───────────────────────────────────────────────
  const listFilesTool = tool({
    name: 'list_files',
    description: 'Lists files in the workspace, excluding node_modules, dist, .git.',
    parameters: z.object({
      directory: z.string().default('.'),
      extensions: z.array(z.string()).optional(),
    }),
    execute: async ({ directory, extensions }: { directory: string; extensions?: string[] }) => ({
      files: await listFiles(workspaceRoot, directory, extensions),
    }),
  });

  // ── search_text ──────────────────────────────────────────────
  const searchTextTool = tool({
    name: 'search_text',
    description: 'Searches files for a text query. Returns file paths and line matches.',
    parameters: z.object({
      query: z.string().min(1),
      directory: z.string().default('.'),
    }),
    execute: async ({ query, directory }: { query: string; directory: string }) => ({
      matches: await searchText(workspaceRoot, query, directory),
    }),
  });

  // ── execute_command ──────────────────────────────────────────
  const executeCommandTool = tool({
    name: 'execute_command',
    description: 'Runs a shell command in the workspace with timeout and output limits. Use for build, test, lint.',
    parameters: z.object({
      command: z.string().min(1),
      cwd: z.string().default('.'),
    }),
    execute: async ({ command, cwd }: { command: string; cwd: string }) =>
      terminal.executeCommand(command, cwd),
  });

  // ── create_file ──────────────────────────────────────────────
  const createFileTool = tool({
    name: 'create_file',
    description: 'Creates a new file in the workspace with path and syntax validation.',
    parameters: z.object({
      filepath: z.string().min(1),
      content: z.string(),
    }),
    execute: async ({ filepath, content }: { filepath: string; content: string }) =>
      editing.createFile(filepath, content),
  });

  // ── edit_file ────────────────────────────────────────────────
  // Permite editar arquivos existentes por substituição de texto
  const editFileTool = tool({
    name: 'edit_file',
    description: 'Edits an existing file by replacing a target string with new content. Use for precise code changes.',
    parameters: z.object({
      filepath: z.string().min(1).describe('Relative path to the file to edit'),
      target: z.string().min(1).describe('Exact string to find and replace (must match exactly)'),
      replacement: z.string().describe('The new content to replace the target with'),
    }),
    execute: async ({ filepath, target, replacement }: { filepath: string; target: string; replacement: string }) => {
      const resolved = path.resolve(workspaceRoot, filepath);
      if (!resolved.startsWith(path.resolve(workspaceRoot))) {
        return { error: 'Path is outside the workspace.' };
      }
      try {
        const content = await readFile(resolved, 'utf8');
        if (!content.includes(target)) {
          return { error: `Target string not found in ${filepath}. Read the file first to get the exact content.` };
        }
        const occurrences = content.split(target).length - 1;
        if (occurrences > 1) {
          return { error: `Target string found ${occurrences} times. Make the target more specific to match exactly once.` };
        }
        const newContent = content.replace(target, replacement);
        await editing.createFile(filepath, newContent);
        return {
          success: true,
          filepath,
          message: `Replaced target (${target.length} chars) with replacement (${replacement.length} chars).`,
          oldContent: content,
          newContent,
        };
      } catch (err) {
        return { error: `Failed to edit ${filepath}: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // ── complete_task ────────────────────────────────────────────
  const completeTaskTool = tool({
    name: 'complete_task',
    description: 'Marks the task as complete or failed with a concise summary in PT-BR.',
    parameters: z.object({
      status: z.enum(['success', 'failure']),
      summary: z.string().min(1),
    }),
    execute: async (args: { status: 'success' | 'failure'; summary: string }) => {
      return { completed: true, status: args.status, summary: args.summary };
    },
  });

  // ── retrieve_context ─────────────────────────────────────────
  const retrieveContextTool = tool({
    name: 'retrieve_context',
    description: 'Indexes the workspace incrementally and retrieves relevant code or documentation chunks using hybrid lexical, structural and recency ranking. Use before planning or editing.',
    parameters: z.object({
      task: z.string().min(1),
      directory: z.string().default('.'),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    execute: async ({ task, directory, limit }) => {
      await rag.indexWorkspace(directory);
      return rag.retrieveHybrid({ task, limit });
    },
  });

  // ── rename_symbol ────────────────────────────────────────────
  const renameSymbolTool = tool({
    name: 'rename_symbol',
    description: 'Uses the TypeScript Language Service to plan a safe symbol rename across references.',
    parameters: z.object({
      filepath: z.string().min(1),
      line: z.number().int().min(1),
      column: z.number().int().min(0),
      newName: z.string().min(1),
    }),
    execute: async ({ filepath, line, column, newName }) => {
      return editing.createRenamePlan({
        filepath,
        position: { line, column },
        newName,
      });
    },
  });

  // ── find_references ──────────────────────────────────────────
  const findReferencesTool = tool({
    name: 'find_references',
    description: 'Uses the TypeScript Language Service to find references for a symbol at a source position.',
    parameters: z.object({
      filepath: z.string().min(1),
      line: z.number().int().min(1),
      column: z.number().int().min(0),
    }),
    execute: async ({ filepath, line, column }) => {
      return editing.findReferences(filepath, { line, column });
    },
  });

  // ── run_tests ────────────────────────────────────────────────
  const runTestsTool = tool({
    name: 'run_tests',
    description: 'Runs the configured npm test command. Use after code changes.',
    parameters: z.object({}),
    execute: async () => {
      const command = process.platform === 'win32' ? 'npm.cmd test' : 'npm test';
      const result = await terminal.executeCommand(command, '.');
      const failures = TerminalOutputParser.parseTestFailures(result.stdout, result.stderr);
      const relatedFiles = TerminalOutputParser.suggestFiles(failures);
      
      return {
        ...result,
        failures,
        relatedFiles,
        summary: failures.length > 0 ? `Failed ${failures.length} tests.` : 'All tests passed.'
      };
    },
  });

  // ── run_linter ───────────────────────────────────────────────
  const runLinterTool = tool({
    name: 'run_linter',
    description: 'Runs npm lint with optional autoFix. Use after formatting-sensitive code changes.',
    parameters: z.object({
      autoFix: z.boolean().default(false),
    }),
    execute: async ({ autoFix }) => {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const command = autoFix ? `${npm} run lint -- --fix` : `${npm} run lint`;
      const beforeStatus = await git.getParsedStatus();
      const result = await terminal.executeCommand(command, '.');
      const afterStatus = await git.getParsedStatus();
      
      const beforeByFile = new Map(beforeStatus.map((status: GitFileStatus) => [status.filepath, status.status]));
      const fixedFiles: string[] = [];
      for (const after of afterStatus) {
        if (!beforeByFile.has(after.filepath) || beforeByFile.get(after.filepath) !== after.status) {
          fixedFiles.push(after.filepath);
        }
      }

      return {
        ...result,
        autoFixApplied: autoFix,
        fixedFiles,
      };
    },
  });

  // ── git_commit ───────────────────────────────────────────────
  const gitCommitTool = tool({
    name: 'git_commit',
    description: 'Adds all changes and commits them with a descriptive message following Conventional Commits.',
    parameters: z.object({
      message: z.string().min(1),
    }),
    execute: async ({ message }) => {
      // simplified without validation gate for now to match SDK scope
      const status = await git.getParsedStatus();
      if (status.length === 0) return { success: false, reason: 'No changes to commit' };
      
      await git.commit(message);
      return { success: true, message: `Committed ${status.length} files.` };
    },
  });

  return {
    readFileTool,
    readFileCompactTool,
    listFilesTool,
    searchTextTool,
    executeCommandTool,
    createFileTool,
    editFileTool,
    completeTaskTool,
    retrieveContextTool,
    renameSymbolTool,
    findReferencesTool,
    runTestsTool,
    runLinterTool,
    gitCommitTool,
  };
}
