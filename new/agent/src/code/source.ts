import { createHash } from 'node:crypto';
import path from 'node:path';
import { CodeLanguage, SourcePosition, SourceRange, TextPatch } from '../types/index.js';

export function detectLanguage(filepath: string): CodeLanguage {
  const ext = path.extname(filepath).toLowerCase();
  switch (ext) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.jsx':
      return 'jsx';
    case '.json':
      return 'json';
    default:
      return 'unknown';
  }
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function indexToPosition(content: string, index: number): SourcePosition {
  const safeIndex = Math.max(0, Math.min(index, content.length));
  const before = content.slice(0, safeIndex);
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length,
    column: lines.at(-1)?.length ?? 0,
    index: safeIndex,
  };
}

export function rangeFromOffsets(content: string, startIndex: number, endIndex: number): SourceRange {
  return {
    start: indexToPosition(content, startIndex),
    end: indexToPosition(content, endIndex),
  };
}

export function positionToIndex(content: string, position: Pick<SourcePosition, 'line' | 'column'>): number {
  const lines = content.split(/\r?\n/);
  const targetLine = Math.max(1, Math.min(position.line, lines.length));
  let index = 0;

  for (let line = 1; line < targetLine; line += 1) {
    index += lines[line - 1].length + 1;
  }

  return index + Math.max(0, Math.min(position.column, lines[targetLine - 1].length));
}

export function applyTextPatches(content: string, patches: TextPatch[]): string {
  const sorted = [...patches].sort((a, b) => b.range.start.index - a.range.start.index);
  let next = content;

  for (const patch of sorted) {
    next = `${next.slice(0, patch.range.start.index)}${patch.newText}${next.slice(patch.range.end.index)}`;
  }

  return next;
}

export function createUnifiedDiff(filepath: string, before: string, after: string): string {
  if (before === after) {
    return '';
  }

  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const lines: string[] = [`--- a/${filepath}`, `+++ b/${filepath}`];
  const max = Math.max(beforeLines.length, afterLines.length);

  lines.push(`@@ -1,${beforeLines.length} +1,${afterLines.length} @@`);
  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine && oldLine !== undefined) {
      lines.push(` ${oldLine}`);
    } else {
      if (oldLine !== undefined) {
        lines.push(`-${oldLine}`);
      }
      if (newLine !== undefined) {
        lines.push(`+${newLine}`);
      }
    }
  }

  return lines.join('\n');
}

export function assertInsideWorkspace(workspaceRoot: string, filepath: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, filepath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path is outside workspace: ${filepath}`);
  }

  return resolved;
}
