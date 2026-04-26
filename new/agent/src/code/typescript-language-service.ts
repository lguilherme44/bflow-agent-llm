import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { CodeDiagnostic, SourcePosition, SourceRange, SymbolReference, TextPatch } from '../types/index.js';
import { indexToPosition, positionToIndex, rangeFromOffsets } from './source.js';

interface ScriptFile {
  version: number;
  text: string;
}

interface ProjectContext {
  service: ts.LanguageService;
  compilerOptions: ts.CompilerOptions;
  rootFiles: string[];
  files: Map<string, ScriptFile>;
}

export class TypeScriptLanguageService {
  private readonly projects = new Map<string, ProjectContext>();

  constructor(private readonly defaultProjectRoot = process.cwd()) {}

  getDiagnostics(filepath: string): CodeDiagnostic[] {
    const { service, fileName } = this.getServiceAndFile(filepath);
    const diagnostics = [
      ...service.getSyntacticDiagnostics(fileName),
      ...service.getSemanticDiagnostics(fileName),
      ...service.getSuggestionDiagnostics(fileName),
    ];

    return diagnostics.map((diagnostic) => this.toCodeDiagnostic(fileName, diagnostic));
  }

  goToDefinition(filepath: string, position: Pick<SourcePosition, 'line' | 'column'>): SymbolReference[] {
    const { service, fileName, project } = this.getServiceAndFile(filepath);
    const offset = positionToIndex(project.files.get(fileName)?.text ?? '', position);
    const definitions = service.getDefinitionAtPosition(fileName, offset) ?? [];

    return definitions.map((definition) => this.toSymbolReference(definition.fileName, definition.textSpan, 'export', definition.name));
  }

  findReferences(filepath: string, position: Pick<SourcePosition, 'line' | 'column'>): SymbolReference[] {
    const { service, fileName, project } = this.getServiceAndFile(filepath);
    const offset = positionToIndex(project.files.get(fileName)?.text ?? '', position);
    const references = service.getReferencesAtPosition(fileName, offset) ?? [];

    return references.map((reference) =>
      this.toSymbolReference(reference.fileName, reference.textSpan, 'call', path.basename(reference.fileName))
    );
  }

  renameSymbol(filepath: string, position: Pick<SourcePosition, 'line' | 'column'>, newName: string): TextPatch[] {
    const { service, fileName, project } = this.getServiceAndFile(filepath);
    const source = project.files.get(fileName)?.text ?? '';
    const offset = positionToIndex(source, position);
    const renameInfo = service.getRenameInfo(fileName, offset);

    if (!renameInfo.canRename) {
      throw new Error(`Cannot rename symbol: ${renameInfo.localizedErrorMessage}`);
    }

    const locations = service.findRenameLocations(fileName, offset, false, false, {
      providePrefixAndSuffixTextForRename: true,
    });

    if (!locations) {
      return [];
    }

    return locations.map((location) => {
      const content = this.readFile(location.fileName, project);
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
    const { service, fileName, project } = this.getServiceAndFile(filepath);
    const changes = service.organizeImports(
      { type: 'file', fileName },
      {},
      {}
    );

    return changes.flatMap((change) => {
      const content = this.readFile(change.fileName, project);
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

  getCodeFixes(filepath: string, range: SourceRange, errorCodes: number[]): TextPatch[] {
    const { service, fileName, project } = this.getServiceAndFile(filepath);
    const content = this.readFile(fileName, project);
    const start = positionToIndex(content, range.start);
    const end = positionToIndex(content, range.end);

    const fixes = service.getCodeFixesAtPosition(fileName, start, end, errorCodes, {}, {});

    return fixes.flatMap((fix) => {
      return fix.changes.flatMap((change) => {
        const changeContent = this.readFile(change.fileName, project);
        return change.textChanges.map((textChange) => {
          const cStart = textChange.span.start;
          const cEnd = textChange.span.start + textChange.span.length;
          return {
            filepath: change.fileName,
            range: rangeFromOffsets(changeContent, cStart, cEnd),
            oldText: changeContent.slice(cStart, cEnd),
            newText: textChange.newText,
          };
        });
      });
    });
  }

  updateFile(filepath: string, text: string): void {
    const resolved = path.resolve(this.defaultProjectRoot, filepath);
    const configPath = this.findClosestConfig(resolved);
    const project = this.ensureProject(configPath);
    
    const previous = project.files.get(resolved);
    project.files.set(resolved, {
      text,
      version: (previous?.version ?? 0) + 1,
    });
  }

  private getServiceAndFile(filepath: string): { service: ts.LanguageService; fileName: string; project: ProjectContext } {
    const resolved = path.resolve(this.defaultProjectRoot, filepath);
    const configPath = this.findClosestConfig(resolved);
    const project = this.ensureProject(configPath);
    return { service: project.service, fileName: resolved, project };
  }

  private findClosestConfig(filepath: string): string {
    let current = path.dirname(filepath);
    while (current.length >= this.defaultProjectRoot.length) {
      const config = path.join(current, 'tsconfig.json');
      if (existsSync(config)) {
        return config;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return path.join(this.defaultProjectRoot, 'tsconfig.json');
  }

  private ensureProject(configPath: string): ProjectContext {
    const cached = this.projects.get(configPath);
    if (cached) return cached;

    const projectRoot = path.dirname(configPath);
    const parsed = existsSync(configPath) ? this.readConfig(configPath) : { options: {}, fileNames: [] };
    
    const files = new Map<string, ScriptFile>();
    const context: ProjectContext = {
      compilerOptions: parsed.options,
      rootFiles: parsed.fileNames.map((file) => path.resolve(file)),
      files,
      service: null as any // Placeholder
    };

    context.service = ts.createLanguageService(this.createHost(context, projectRoot), ts.createDocumentRegistry());
    this.projects.set(configPath, context);
    return context;
  }

  private createHost(project: ProjectContext, projectRoot: string): ts.LanguageServiceHost {
    return {
      getCompilationSettings: () => project.compilerOptions,
      getCurrentDirectory: () => projectRoot,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      getScriptFileNames: () => Array.from(new Set([...project.rootFiles, ...project.files.keys()])),
      getScriptVersion: (fileName) => String(project.files.get(path.resolve(fileName))?.version ?? 0),
      getScriptSnapshot: (fileName) => {
        const resolved = path.resolve(fileName);
        if (!ts.sys.fileExists(resolved)) {
          return undefined;
        }
        const text = this.readFile(resolved, project);
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

  private readFile(fileName: string, project: ProjectContext): string {
    const resolved = path.resolve(fileName);
    const cached = project.files.get(resolved);
    if (cached) {
      return cached.text;
    }

    const text = readFileSync(resolved, 'utf8');
    project.files.set(resolved, { text, version: 1 });
    return text;
  }

  private toCodeDiagnostic(fileName: string, diagnostic: ts.Diagnostic): CodeDiagnostic {
    // We need to find the project to read the file content
    const configPath = this.findClosestConfig(fileName);
    const project = this.ensureProject(configPath);
    
    const content = this.readFile(fileName, project);
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
    const configPath = this.findClosestConfig(fileName);
    const project = this.ensureProject(configPath);
    
    const content = this.readFile(fileName, project);
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
