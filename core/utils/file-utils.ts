import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertInsideWorkspace } from '../code/source.js';
import { JsonValue } from '../types/index.js';

/**
 * Lists files in the workspace, excluding common non-source directories.
 * Capped at 500 files to avoid flooding the agent context.
 */
export async function listFiles(workspaceRoot: string, directory: string, extensions?: string[]): Promise<string[]> {
  const root = assertInsideWorkspace(workspaceRoot, directory);
  const output: string[] = [];
  const ignored = new Set(['node_modules', 'dist', '.git', '.agent', '.agent-checkpoints', 'build', 'out']);

  async function walk(current: string): Promise<void> {
    if (output.length > 500) return;

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

/**
 * Searches workspace files for a literal text query.
 * Returns matching file paths, line numbers and previews, capped at 100 matches.
 */
export async function searchText(workspaceRoot: string, query: string, directory: string): Promise<Array<Record<string, JsonValue>>> {
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

/**
 * Options for creating tool registries or SDK tools.
 * Shared interface for dependency injection.
 */
export interface DevelopmentToolOptions {
  workspaceRoot?: string;
  codeEditingService?: any;
  parserService?: any;
  astGrepService?: any;
  tsLanguageService?: any;
  terminalService?: any;
  ragService?: any;
  gitService?: any;
}
