/**
 * Polyglot Parser — lightweight structure extraction for languages
 * without full Tree-sitter grammars (Python, SQL, YAML, Dockerfile, Terraform).
 *
 * Falls back to regex-based symbol extraction.
 */
import { CodeLanguage, SymbolReference, SourceRange, AstNode, CodeDiagnostic } from '../types/index.js';

export interface PolyglotParseResult {
  symbols: SymbolReference[];
  imports: SymbolReference[];
  exports: SymbolReference[];
  diagnostics: CodeDiagnostic[];
  ast: AstNode;
}

/**
 * Extract structure from a file without a full AST parser.
 * Uses language-specific heuristics.
 */
export function polyglotParse(
  filepath: string,
  content: string,
  language: CodeLanguage
): PolyglotParseResult {
  const symbols: SymbolReference[] = [];
  const imports: SymbolReference[] = [];
  const exports: SymbolReference[] = [];
  const diagnostics: CodeDiagnostic[] = [];

  const lines = content.split('\n');

  switch (language) {
    case 'python':
      extractPython(lines, filepath, symbols, imports);
      break;
    case 'sql':
      extractSQL(lines, filepath, symbols);
      break;
    case 'yaml':
      extractYAML(lines, filepath, symbols);
      break;
    case 'dockerfile':
      extractDockerfile(lines, filepath, symbols);
      break;
    case 'terraform':
      extractTerraform(lines, filepath, symbols);
      break;
    default:
      break;
  }

  const ast: AstNode = {
    id: `file:${filepath}`,
    kind: 'file',
    name: filepath,
    range: { start: { line: 1, column: 0, index: 0 }, end: { line: lines.length, column: 0, index: content.length } },
    children: symbols.map(s => ({
      id: `sym:${s.name}`,
      kind: s.kind,
      name: s.name,
      range: s.range,
    })),
  };

  return { symbols, imports, exports, diagnostics, ast };
}

// ── Python ──────────────────────────────────────────────────

function extractPython(lines: string[], filepath: string, symbols: SymbolReference[], imports: SymbolReference[]) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Imports
    const importMatch = line.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)/);
    if (importMatch) {
      const names = importMatch[2].split(',').map(n => n.trim().split(' as ')[0].trim());
      for (const name of names) {
        imports.push({
          name,
          kind: 'import',
          filepath,
          range: lineRange(i, line, line.indexOf(name)),
          importedFrom: importMatch[1] || undefined,
        });
      }
      continue;
    }

    // Functions: def name(...):
    const funcMatch = line.match(/^def\s+(\w+)\s*\(/);
    if (funcMatch) {
      symbols.push({ name: funcMatch[1], kind: 'function', filepath, range: lineRange(i, line, line.indexOf('def')) });
      continue;
    }

    // Async functions: async def name(...):
    const asyncFuncMatch = line.match(/^async\s+def\s+(\w+)\s*\(/);
    if (asyncFuncMatch) {
      symbols.push({ name: asyncFuncMatch[1], kind: 'arrow_function', filepath, range: lineRange(i, line, line.indexOf('async')) });
      continue;
    }

    // Classes: class Name(...):
    const classMatch = line.match(/^class\s+(\w+)/);
    if (classMatch) {
      symbols.push({ name: classMatch[1], kind: 'class', filepath, range: lineRange(i, line, line.indexOf('class')) });
      continue;
    }

    // Decorators: @decorator
    const decoratorMatch = line.match(/^@(\w+)/);
    if (decoratorMatch) {
      symbols.push({ name: decoratorMatch[1], kind: 'hook', filepath, range: lineRange(i, line, line.indexOf('@')) });
    }
  }
}

// ── SQL ──────────────────────────────────────────────────────

function extractSQL(lines: string[], filepath: string, symbols: SymbolReference[]) {
  const full = lines.join('\n');

  // CREATE TABLE
  for (const m of full.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+\.?\w*)/gi)) {
    symbols.push({ name: m[1], kind: 'class', filepath, range: lineRange(0, full, m.index || 0) });
  }

  // CREATE INDEX
  for (const m of full.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(\w+)/gi)) {
    symbols.push({ name: m[1], kind: 'function', filepath, range: lineRange(0, full, m.index || 0) });
  }

  // CREATE FUNCTION / PROCEDURE
  for (const m of full.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(\w+)/gi)) {
    symbols.push({ name: m[1], kind: 'function', filepath, range: lineRange(0, full, m.index || 0) });
  }

  // CREATE VIEW
  for (const m of full.matchAll(/CREATE\s+(?:MATERIALIZED\s+)?VIEW\s+(\w+)/gi)) {
    symbols.push({ name: m[1], kind: 'interface', filepath, range: lineRange(0, full, m.index || 0) });
  }
}

// ── YAML ─────────────────────────────────────────────────────

function extractYAML(lines: string[], filepath: string, symbols: SymbolReference[]) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Top-level keys (Kubernetes kinds, compose services, CI jobs)
    const keyMatch = line.match(/^(\w[\w-]*)\s*:/);
    if (keyMatch && !line.startsWith(' ') && !line.startsWith('#')) {
      const name = keyMatch[1];
      // Skip common non-symbol keys
      if (!['apiVersion', 'kind', 'metadata', 'spec', 'status', 'data', 'items'].includes(name)) {
        symbols.push({ name, kind: 'json_property', filepath, range: lineRange(i, line, 0) });
      }
    }

    // Inline YAML keys
    const inlineMatch = line.match(/^\s{2}(\w[\w-]*)\s*:/);
    if (inlineMatch) {
      const name = inlineMatch[1];
      if (!['name', 'namespace', 'labels', 'annotations'].includes(name)) {
        symbols.push({ name, kind: 'json_property', filepath, range: lineRange(i, line, 2) });
      }
    }
  }
}

// ── Dockerfile ───────────────────────────────────────────────

function extractDockerfile(lines: string[], filepath: string, symbols: SymbolReference[]) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toUpperCase();

    // FROM, RUN, COPY, EXPOSE, ENV, CMD, ENTRYPOINT, VOLUME, WORKDIR, etc.
    const match = line.match(/^(FROM|RUN|COPY|ADD|EXPOSE|ENV|CMD|ENTRYPOINT|VOLUME|WORKDIR|ARG|LABEL|USER|HEALTHCHECK)\s/);
    if (match) {
      symbols.push({ name: match[1], kind: 'call', filepath, range: lineRange(i, lines[i], 0) });
    }
  }
}

// ── Terraform ────────────────────────────────────────────────

function extractTerraform(lines: string[], filepath: string, symbols: SymbolReference[]) {
  const full = lines.join('\n');

  // resource "type" "name"
  for (const m of full.matchAll(/resource\s+"(\w+)"\s+"(\w+)"/g)) {
    symbols.push({ name: `${m[1]}.${m[2]}`, kind: 'class', filepath, range: lineRange(0, full, m.index || 0) });
  }

  // module "name"
  for (const m of full.matchAll(/module\s+"(\w+)"/g)) {
    symbols.push({ name: m[1], kind: 'class', filepath, range: lineRange(0, full, m.index || 0) });
  }

  // variable "name"
  for (const m of full.matchAll(/variable\s+"(\w+)"/g)) {
    symbols.push({ name: m[1], kind: 'json_property', filepath, range: lineRange(0, full, m.index || 0) });
  }

  // output "name"
  for (const m of full.matchAll(/output\s+"(\w+)"/g)) {
    symbols.push({ name: m[1], kind: 'export', filepath, range: lineRange(0, full, m.index || 0) });
  }

  // data "type" "name"
  for (const m of full.matchAll(/data\s+"(\w+)"\s+"(\w+)"/g)) {
    symbols.push({ name: `data.${m[1]}.${m[2]}`, kind: 'call', filepath, range: lineRange(0, full, m.index || 0) });
  }
}

function lineRange(line: number, _content: string, col: number): SourceRange {
  return {
    start: { line: line + 1, column: col, index: 0 },
    end: { line: line + 1, column: col + 10, index: 0 },
  };
}
