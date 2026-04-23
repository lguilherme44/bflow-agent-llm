import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { CodeDiagnostic, SourcePosition, SourceRange, SymbolReference, TextPatch } from '../types/index.js';
import { indexToPosition, positionToIndex, rangeFromOffsets } from './source.js';

interface ScriptFile {
  version: number;
  text: string;
}

export class TypeScriptLanguageService {
  private readonly files = new Map<string, ScriptFile>();
  private readonly service: ts.LanguageService;
  private readonly compilerOptions: ts.CompilerOptions;
  private readonly rootFiles: string[];

  constructor(private readonly projectRoot = process.cwd(), tsconfigPath?: string) {
    const configPath = tsconfigPath ?? ts.findConfigFile(projectRoot, ts.sys.fileExists, 'tsconfig.json');
    const parsed = configPath ? this.readConfig(configPath) : { options: {}, fileNames: [] };
    this.compilerOptions = parsed.options;
    this.rootFiles = parsed.fileNames.map((file) => path.resolve(file));
    this.service = ts.createLanguageService(this.createHost(), ts.createDocumentRegistry());
  }

  getDiagnostics(filepath: string): CodeDiagnostic[] {
    const fileName = this.ensureFile(filepath);
    const diagnostics = [
      ...this.service.getSyntacticDiagnostics(fileName),
      ...this.service.getSemanticDiagnostics(fileName),
      ...this.service.getSuggestionDiagnostics(fileName),
    ];

    return diagnostics.map((diagnostic) => this.toCodeDiagnostic(fileName, diagnostic));
  }

  goToDefinition(filepath: string, position: Pick<SourcePosition, 'line' | 'column'>): SymbolReference[] {
    const fileName = this.ensureFile(filepath);
    const offset = positionToIndex(this.files.get(fileName)?.text ?? '', position);
    const definitions = this.service.getDefinitionAtPosition(fileName, offset) ?? [];

    return definitions.map((definition) => this.toSymbolReference(definition.fileName, definition.textSpan, 'export', definition.name));
  }

  findReferences(filepath: string, position: Pick<SourcePosition, 'line' | 'column'>): SymbolReference[] {
    const fileName = this.ensureFile(filepath);
    const offset = positionToIndex(this.files.get(fileName)?.text ?? '', position);
    const references = this.service.getReferencesAtPosition(fileName, offset) ?? [];

    return references.map((reference) =>
      this.toSymbolReference(reference.fileName, reference.textSpan, 'call', path.basename(reference.fileName))
    );
  }

  renameSymbol(filepath: string, position: Pick<SourcePosition, 'line' | 'column'>, newName: string): TextPatch[] {
    const fileName = this.ensureFile(filepath);
    const source = this.files.get(fileName)?.text ?? '';
    const offset = positionToIndex(source, position);
    const renameInfo = this.service.getRenameInfo(fileName, offset);

    if (!renameInfo.canRename) {
      throw new Error(`Cannot rename symbol: ${renameInfo.localizedErrorMessage}`);
    }

    const locations = this.service.findRenameLocations(fileName, offset, false, false, {
      providePrefixAndSuffixTextForRename: true,
    });

    if (!locations) {
      return [];
    }

    return locations.map((location) => {
      const content = this.readFile(location.fileName);
      const start = location.textSpan.start;
      const end = location.textSpan.start + location.textSpan.length;
      const prefix = location.prefixText ?? '';
      const suffix = location.suffixText ?? '';
      return {
        filepath: location.fileName,
        range: rangeFromOffsets(content, start, end),
        oldText: content.slice(start, end),
        newText: `${prefix}${newName}${suffix}`,
      };
    });
  }

  organizeImports(filepath: string): TextPatch[] {
    const fileName = this.ensureFile(filepath);
    const changes = this.service.organizeImports(
      { type: 'file', fileName },
      {},
      {}
    );

    return changes.flatMap((change) => {
      const content = this.readFile(change.fileName);
      return change.textChanges.map((textChange) => {
        const start = textChange.span.start;
        const end = textChange.span.start + textChange.span.length;
        return {
          filepath: change.fileName,
          range: rangeFromOffsets(content, start, end),
          oldText: content.slice(start, end),
          newText: textChange.newText,
        };
      });
    });
  }

  updateFile(filepath: string, text: string): void {
    const fileName = path.resolve(this.projectRoot, filepath);
    const previous = this.files.get(fileName);
    this.files.set(fileName, {
      text,
      version: (previous?.version ?? 0) + 1,
    });
  }

  private createHost(): ts.LanguageServiceHost {
    return {
      getCompilationSettings: () => this.compilerOptions,
      getCurrentDirectory: () => this.projectRoot,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      getScriptFileNames: () => Array.from(new Set([...this.rootFiles, ...this.files.keys()])),
      getScriptVersion: (fileName) => String(this.files.get(path.resolve(fileName))?.version ?? 0),
      getScriptSnapshot: (fileName) => {
        const resolved = path.resolve(fileName);
        if (!ts.sys.fileExists(resolved)) {
          return undefined;
        }
        const text = this.readFile(resolved);
        return ts.ScriptSnapshot.fromString(text);
      },
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
    };
  }

  private readConfig(configPath: string): ts.ParsedCommandLine {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
    }

    return ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath)
    );
  }

  private ensureFile(filepath: string): string {
    const fileName = path.resolve(this.projectRoot, filepath);
    this.readFile(fileName);
    return fileName;
  }

  private readFile(fileName: string): string {
    const resolved = path.resolve(fileName);
    const cached = this.files.get(resolved);
    if (cached) {
      return cached.text;
    }

    const text = readFileSync(resolved, 'utf8');
    this.files.set(resolved, { text, version: 1 });
    return text;
  }

  private toCodeDiagnostic(fileName: string, diagnostic: ts.Diagnostic): CodeDiagnostic {
    const content = this.readFile(fileName);
    const start = diagnostic.start ?? 0;
    const end = start + (diagnostic.length ?? 0);

    return {
      filepath: fileName,
      severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      range: rangeFromOffsets(content, start, end),
      code: diagnostic.code,
    };
  }

  private toSymbolReference(
    fileName: string,
    textSpan: ts.TextSpan,
    kind: SymbolReference['kind'],
    name: string
  ): SymbolReference {
    const content = this.readFile(fileName);
    const range: SourceRange = {
      start: indexToPosition(content, textSpan.start),
      end: indexToPosition(content, textSpan.start + textSpan.length),
    };

    return {
      name,
      kind,
      filepath: fileName,
      range,
    };
  }
}
