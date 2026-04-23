import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { AstNode, CodeDiagnostic, CodeDocument, CodeLanguage, SourceRange, SymbolReference } from '../types/index.js';
import { detectLanguage, hashContent } from './source.js';
import { TREE_SITTER_QUERIES } from './tree-sitter-queries.js';

// Cria um require compatível com ESM
const require = createRequire(import.meta.url);
const Parser = require('tree-sitter');

const TypeScriptGrammar = require('tree-sitter-typescript') as {
  typescript: unknown;
  tsx: unknown;
};
const JavaScriptGrammar = require('tree-sitter-javascript') as unknown;
const JsonGrammar = require('tree-sitter-json') as unknown;

interface CachedTree {
  hash: string;
  tree: any; // Parser.Tree
  document: CodeDocument;
}

export class TreeSitterParserService {
  private readonly parsers = new Map<CodeLanguage, any>();
  private readonly cache = new Map<string, CachedTree>();

  constructor(private readonly maxAstDepth = 6) {}

  async parseFileAst(filepath: string): Promise<CodeDocument> {
    const content = await readFile(filepath, 'utf8');
    return this.parseText(filepath, content);
  }

  parseText(filepath: string, content: string): CodeDocument {
    const language = detectLanguage(filepath);
    const contentHash = hashContent(content);
    const cacheKey = `${filepath}:${language}`;
    const cached = this.cache.get(cacheKey);

    if (cached?.hash === contentHash) {
      return cached.document;
    }

    if (language === 'unknown') {
      const document: CodeDocument = {
        filepath,
        language,
        content,
        contentHash,
        parsedAt: new Date().toISOString(),
        ast: {
          id: '0',
          kind: 'document',
          range: {
            start: { line: 1, column: 0, index: 0 },
            end: { line: content.split(/\r?\n/).length, column: 0, index: content.length },
          },
        },
        symbols: [],
        imports: [],
        exports: [],
        diagnostics: [],
      };
      this.cache.set(cacheKey, { hash: contentHash, tree: null as any, document });
      return document;
    }

    const parser = this.getParser(language);
    const tree = parser.parse(content, cached?.tree);
    const rootNode = tree.rootNode;
    const symbols = this.collectSymbols(filepath, rootNode);
    const imports = symbols.filter((symbol) => symbol.kind === 'import');
    const exports = symbols.filter((symbol) => symbol.kind === 'export');
    const diagnostics = this.collectDiagnostics(filepath, rootNode);

    const document: CodeDocument = {
      filepath,
      language,
      content,
      contentHash,
      parsedAt: new Date().toISOString(),
      ast: this.toAstNode(rootNode, 0),
      symbols,
      imports,
      exports,
      diagnostics,
    };

    this.cache.set(cacheKey, { hash: contentHash, tree, document });
    return document;
  }

  clearCache(filepath?: string): void {
    if (!filepath) {
      this.cache.clear();
      return;
    }

    for (const key of this.cache.keys()) {
      if (key.startsWith(`${filepath}:`)) {
        this.cache.delete(key);
      }
    }
  }

  private getParser(language: CodeLanguage): any {
    const cached = this.parsers.get(language);
    if (cached) {
      return cached;
    }

    const parser = new Parser();
    parser.setLanguage(this.getGrammar(language));
    this.parsers.set(language, parser);
    return parser;
  }

  private getGrammar(language: CodeLanguage): unknown {
    switch (language) {
      case 'typescript':
        return TypeScriptGrammar.typescript;
      case 'tsx':
      case 'jsx':
        return TypeScriptGrammar.tsx;
      case 'javascript':
        return JavaScriptGrammar;
      case 'json':
        return JsonGrammar;
      case 'unknown':
        return JavaScriptGrammar;
    }
  }

  private collectDiagnostics(filepath: string, rootNode: any): CodeDiagnostic[] {
    if (!rootNode.hasError) {
      return [];
    }

    const diagnostics: CodeDiagnostic[] = [];
    this.walk(rootNode, (node) => {
      if (node.isError || node.isMissing) {
        diagnostics.push({
          filepath,
          severity: 'error',
          message: `Tree-sitter parse issue at ${node.type}`,
          range: this.nodeRange(node),
          code: node.type,
        });
      }
    });
    return diagnostics;
  }

  private collectSymbols(filepath: string, rootNode: any): SymbolReference[] {
    const language = detectLanguage(filepath);
    const queryConfig = TREE_SITTER_QUERIES.find((q) => q.language === language);
    
    if (!queryConfig) {
      // Fallback to manual walk if no query is defined
      const symbols: SymbolReference[] = [];
      this.walk(rootNode, (node) => {
        const symbol = this.symbolForNode(filepath, node);
        if (symbol) symbols.push(symbol);
      });
      return symbols;
    }

    const grammar = this.getGrammar(language);
    const query = new Parser.Query(grammar, queryConfig.query);
    const matches = query.matches(rootNode);
    const symbols: SymbolReference[] = [];

    for (const match of matches) {
      for (const capture of match.captures) {
        // We only care about the top-level captures (the ones without dots in name like @function)
        // Sub-captures like @function.name are used for identification but handled here
        if (!capture.name.includes('.')) {
          const kind = capture.name as SymbolReference['kind'];
          const node = capture.node;
          
          // Find the name capture for this symbol
          const nameCapture = match.captures.find((c: any) => c.name === `${capture.name}.name`);
          const name = nameCapture ? nameCapture.node.text : this.bestNodeName(node);
          
          const symbol = this.makeSymbol(
            filepath,
            node,
            kind === 'call' && /^use[A-Z0-9]/.test(name || '') ? 'hook' : kind,
            name,
            this.isExported(node)
          );
          
          if (symbol) {
            // For imports, try to find the source
            if (kind === 'import') {
              const sourceCapture = match.captures.find((c: any) => c.name === 'import.source');
              if (sourceCapture) {
                symbol.importedFrom = sourceCapture.node.text.replace(/^['"]|['"]$/g, '');
              }
            }
            symbols.push(symbol);
          }
        }
      }
    }

    return symbols;
  }

  private isExported(node: any): boolean {
    const parent = node.parent;
    return (
      parent?.type === 'export_statement' ||
      parent?.type === 'export_declaration' ||
      (parent?.type === 'lexical_declaration' && parent.parent?.type === 'export_statement')
    );
  }

  private symbolForNode(filepath: string, node: any): SymbolReference | null {
    switch (node.type) {
      case 'function_declaration':
        return this.makeSymbol(filepath, node, 'function', this.nameFromField(node, 'name'));
      case 'class_declaration':
        return this.makeSymbol(filepath, node, 'class', this.nameFromField(node, 'name'));
      case 'method_definition':
        return this.makeSymbol(filepath, node, 'method', this.nameFromField(node, 'name'));
      case 'interface_declaration':
        return this.makeSymbol(filepath, node, 'interface', this.nameFromField(node, 'name'));
      case 'type_alias_declaration':
        return this.makeSymbol(filepath, node, 'type', this.nameFromField(node, 'name'));
      case 'import_statement':
        return this.makeSymbol(filepath, node, 'import', this.importSource(node), false, this.importSource(node));
      case 'export_statement':
        return this.makeSymbol(filepath, node, 'export', this.exportName(node), true);
      case 'jsx_element':
      case 'jsx_self_closing_element':
        return this.makeSymbol(filepath, node, 'jsx_element', this.jsxName(node));
      case 'call_expression':
        return this.callSymbol(filepath, node);
      case 'pair':
        return this.makeSymbol(filepath, node, 'json_property', this.nameFromField(node, 'key'));
      case 'variable_declarator':
        if (node.childForFieldName('value')?.type === 'arrow_function') {
          return this.makeSymbol(filepath, node, 'arrow_function', this.nameFromField(node, 'name'));
        }
        return null;
      default:
        return null;
    }
  }

  private callSymbol(filepath: string, node: any): SymbolReference | null {
    const rawName = this.nameFromField(node, 'function');
    if (!rawName) {
      return null;
    }

    const cleanName = rawName.replace(/\s+/g, '');
    const kind = /^use[A-Z0-9]/.test(cleanName) ? 'hook' : 'call';
    return this.makeSymbol(filepath, node, kind, cleanName);
  }

  private makeSymbol(
    filepath: string,
    node: any,
    kind: SymbolReference['kind'],
    name?: string,
    exported?: boolean,
    importedFrom?: string
  ): SymbolReference | null {
    const finalName = name?.replace(/^['"]|['"]$/g, '') || node.type;
    return {
      name: finalName,
      kind,
      filepath,
      range: this.nodeRange(node),
      exported,
      importedFrom,
    };
  }

  private toAstNode(node: any, depth: number): AstNode {
    const children =
      depth < this.maxAstDepth
        ? node.namedChildren.slice(0, 80).map((child: any) => this.toAstNode(child, depth + 1))
        : undefined;

    return {
      id: String(node.id),
      kind: node.type,
      name: this.bestNodeName(node),
      range: this.nodeRange(node),
      text: node.text.length <= 160 ? node.text : undefined,
      children,
    };
  }

  private walk(node: any, visitor: (node: any) => void): void {
    visitor(node);
    for (const child of node.namedChildren) {
      this.walk(child, visitor);
    }
  }

  private nodeRange(node: any): SourceRange {
    return {
      start: {
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        index: node.startIndex,
      },
      end: {
        line: node.endPosition.row + 1,
        column: node.endPosition.column,
        index: node.endIndex,
      },
    };
  }

  private bestNodeName(node: any): string | undefined {
    return (
      this.nameFromField(node, 'name') ??
      this.nameFromField(node, 'key') ??
      this.nameFromField(node, 'function') ??
      this.importSource(node) ??
      undefined
    );
  }

  private nameFromField(node: any, field: string): string | undefined {
    return node.childForFieldName(field)?.text;
  }

  private importSource(node: any): string | undefined {
    return node.childForFieldName('source')?.text.replace(/^['"]|['"]$/g, '');
  }

  private exportName(node: any): string | undefined {
    const declaration = node.childForFieldName('declaration');
    return declaration ? this.bestNodeName(declaration) : node.text.slice(0, 80);
  }

  private jsxName(node: any): string | undefined {
    const opening = node.namedChildren.find((child: any) => child.type === 'jsx_opening_element' || child.type === 'jsx_self_closing_element');
    return opening?.childForFieldName('name')?.text ?? opening?.namedChildren[0]?.text;
  }
}
