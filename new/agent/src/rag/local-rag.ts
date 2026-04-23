import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  CodeLanguage,
  RetrievalChunk,
  RetrievalChunkMetadata,
  RetrievalResult,
  SymbolReference,
} from '../types/index.js';
import { detectLanguage, hashContent } from '../code/source.js';
import { TreeSitterParserService } from '../code/tree-sitter-parser.js';
import { estimateTokensFromText } from '../utils/json.js';
import lunr from 'lunr';
import { RankingUtils } from './ranking-utils.js';

export interface RetrieveContextInput {
  task: string;
  filters?: {
    languages?: Array<CodeLanguage | 'markdown'>;
    filepaths?: string[];
    chunkKinds?: RetrievalChunkMetadata['chunkKind'][];
  };
  limit?: number;
}

export interface RagIndexStats {
  filesIndexed: number;
  chunksIndexed: number;
  skippedFiles: number;
}

export class LocalRagService {
  private readonly chunks = new Map<string, RetrievalChunk>();
  private readonly fileHashes = new Map<string, string>();
  private lunrIndex: lunr.Index | null = null;

  constructor(
    private readonly workspaceRoot = process.cwd(),
    private readonly parser = new TreeSitterParserService()
  ) {}

  async indexWorkspace(directory = '.'): Promise<RagIndexStats> {
    const targetPath = path.resolve(this.workspaceRoot, directory);
    const targetStat = await stat(targetPath);
    
    let files: string[];
    if (targetStat.isFile()) {
      files = isIndexable(targetPath) ? [targetPath] : [];
    } else {
      files = await this.listIndexableFiles(targetPath);
    }

    let filesIndexed = 0;
    let skippedFiles = 0;

    for (const filepath of files) {
      const changed = await this.indexFile(filepath);
      if (changed) {
        filesIndexed += 1;
      } else {
        skippedFiles += 1;
      }
    }

    this.rebuildLunrIndex();

    return {
      filesIndexed,
      chunksIndexed: this.chunks.size,
      skippedFiles,
    };
  }

  async indexFile(filepath: string): Promise<boolean> {
    const resolved = path.resolve(this.workspaceRoot, filepath);
    const content = await readFile(resolved, 'utf8');
    const contentHash = hashContent(content);

    if (this.fileHashes.get(resolved) === contentHash) {
      return false;
    }

    for (const key of Array.from(this.chunks.keys())) {
      if (key.startsWith(`${resolved}:`)) {
        this.chunks.delete(key);
      }
    }

    const chunks = await this.createChunks(resolved, content, contentHash);
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk);
    }

    this.fileHashes.set(resolved, contentHash);
    return true;
  }

  retrieve(input: RetrieveContextInput): RetrievalResult[] {
    const limit = input.limit ?? 8;
    const filteredChunks = Array.from(this.chunks.values()).filter((chunk) =>
      this.matchesFilters(chunk, input.filters)
    );

    if (filteredChunks.length === 0) return [];

    // 1. Lexical Search (lunr)
    const lexicalResults: RetrievalChunk[] = [];
    if (this.lunrIndex) {
      const results = this.lunrIndex.search(input.task);
      for (const res of results) {
        const chunk = this.chunks.get(res.ref);
        if (chunk && this.matchesFilters(chunk, input.filters)) {
          lexicalResults.push(chunk);
        }
      }
    }

    // 2. Recency Ranking
    const recencyResults = [...filteredChunks].sort((a, b) => {
      const dateA = new Date(a.metadata.modifiedAt).getTime();
      const dateB = new Date(b.metadata.modifiedAt).getTime();
      return dateB - dateA;
    });

    // 3. Centrality Ranking (Simple heuristic: symbols in src > docs > tests)
    const centralityResults = [...filteredChunks].sort((a, b) => {
      const scoreA = (a.metadata.owner === 'src' ? 10 : 0) + a.metadata.symbols.length;
      const scoreB = (b.metadata.owner === 'src' ? 10 : 0) + b.metadata.symbols.length;
      return scoreB - scoreA;
    });

    // 4. Combine with RRF
    const combined = RankingUtils.rrf([lexicalResults, recencyResults, centralityResults]);
    
    return combined.slice(0, limit).map(({ item, score }) => {
      const reasons: string[] = [];
      if (lexicalResults.includes(item)) reasons.push('lexical match');
      if (recencyResults.slice(0, 10).includes(item)) reasons.push('recent file');
      if (centralityResults.slice(0, 10).includes(item)) reasons.push('structural centrality');
      
      return {
        chunk: item,
        score,
        reasons
      };
    });
  }

  getIndexedChunks(): RetrievalChunk[] {
    return Array.from(this.chunks.values());
  }

  private async createChunks(filepath: string, content: string, contentHash: string): Promise<RetrievalChunk[]> {
    const language = detectLanguage(filepath);
    const fileStat = await stat(filepath);
    const modifiedAt = fileStat.mtime.toISOString();

    if (filepath.endsWith('.md')) {
      return this.chunkMarkdown(filepath, content, contentHash, modifiedAt);
    }

    if (language === 'unknown') {
      return [];
    }

    const document = this.parser.parseText(filepath, content);
    const symbolChunks = document.symbols
      .filter((symbol) => this.isChunkableSymbol(symbol))
      .slice(0, 200)
      .map((symbol) => {
        const chunkContent = content.slice(symbol.range.start.index, symbol.range.end.index);
        return this.makeChunk(filepath, chunkContent, contentHash, {
          filepath,
          language,
          symbols: [symbol.name],
          imports: document.imports.map((item) => item.importedFrom ?? item.name),
          exports: document.exports.map((item) => item.name),
          modifiedAt,
          owner: ownerFromPath(filepath),
          module: moduleFromPath(this.workspaceRoot, filepath),
          chunkKind: this.chunkKind(filepath, symbol),
        });
      });

    if (symbolChunks.length > 0) {
      return symbolChunks;
    }

    return [
      this.makeChunk(filepath, content.slice(0, 8_000), contentHash, {
        filepath,
        language,
        symbols: document.symbols.map((item) => item.name).slice(0, 40),
        imports: document.imports.map((item) => item.importedFrom ?? item.name),
        exports: document.exports.map((item) => item.name),
        modifiedAt,
        owner: ownerFromPath(filepath),
        module: moduleFromPath(this.workspaceRoot, filepath),
        chunkKind: 'file',
      }),
    ];
  }

  private chunkMarkdown(
    filepath: string,
    content: string,
    contentHash: string,
    modifiedAt: string
  ): RetrievalChunk[] {
    const sections = content
      .split(/(?=^#{1,6}\s+)/m)
      .map((section) => section.trim())
      .filter(Boolean);

    return (sections.length > 0 ? sections : [content]).map((section) =>
      this.makeChunk(filepath, section, contentHash, {
        filepath,
        language: 'markdown',
        symbols: [section.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? path.basename(filepath)],
        imports: [],
        exports: [],
        modifiedAt,
        owner: ownerFromPath(filepath),
        module: moduleFromPath(this.workspaceRoot, filepath),
        chunkKind: filepath.toLowerCase().includes('adr') ? 'adr' : 'markdown',
      })
    );
  }

  private makeChunk(
    filepath: string,
    content: string,
    contentHash: string,
    metadata: RetrievalChunkMetadata
  ): RetrievalChunk {
    const id = `${filepath}:${hashContent(content).slice(0, 16)}`;
    return {
      id,
      content,
      contentHash,
      metadata,
      tokensEstimate: estimateTokensFromText(content),
      indexedAt: new Date().toISOString(),
    };
  }

  private matchesFilters(chunk: RetrievalChunk, filters: RetrieveContextInput['filters']): boolean {
    if (!filters) {
      return true;
    }

    if (filters.languages && !filters.languages.includes(chunk.metadata.language)) {
      return false;
    }

    if (filters.chunkKinds && !filters.chunkKinds.includes(chunk.metadata.chunkKind)) {
      return false;
    }

    if (filters.filepaths && !filters.filepaths.some((filepath) => chunk.metadata.filepath.endsWith(filepath))) {
      return false;
    }

    return true;
  }

  private async listIndexableFiles(directory: string): Promise<string[]> {
    const output: string[] = [];
    const ignored = new Set(['node_modules', 'dist', '.git', '.agent-checkpoints', '.checkpoints']);

    async function walk(current: string): Promise<void> {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (ignored.has(entry.name)) {
          continue;
        }

        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (isIndexable(fullPath)) {
          output.push(fullPath);
        }
      }
    }

    await walk(directory);
    return output;
  }

  private isChunkableSymbol(symbol: SymbolReference): boolean {
    return ['function', 'arrow_function', 'class', 'method', 'interface', 'type', 'hook'].includes(symbol.kind);
  }

  private chunkKind(filepath: string, symbol: SymbolReference): RetrievalChunkMetadata['chunkKind'] {
    const lower = filepath.toLowerCase();
    if (lower.includes('.test.') || lower.includes('.spec.')) {
      return 'test';
    }
    if (lower.includes('route') || lower.includes('controller')) {
      return 'route';
    }
    return symbol.kind === 'function' || symbol.kind === 'method' ? 'symbol' : 'file';
  }

  private rebuildLunrIndex(): void {
    const chunks = Array.from(this.chunks.values());
    this.lunrIndex = lunr(function () {
      this.ref('id');
      this.field('content');
      this.field('filepath');
      this.field('symbols');

      for (const chunk of chunks) {
        this.add({
          id: chunk.id,
          content: chunk.content,
          filepath: chunk.metadata.filepath,
          symbols: chunk.metadata.symbols.join(' '),
        });
      }
    });
  }
}

function isIndexable(filepath: string): boolean {
  return ['.ts', '.tsx', '.js', '.jsx', '.json', '.md'].includes(path.extname(filepath).toLowerCase());
}

function ownerFromPath(filepath: string): string | undefined {
  const normalized = filepath.replace(/\\/g, '/');
  if (normalized.includes('/src/')) {
    return 'src';
  }
  if (normalized.includes('/tests/') || normalized.includes('/test/')) {
    return 'tests';
  }
  if (normalized.includes('/docs/')) {
    return 'docs';
  }
  return undefined;
}

function moduleFromPath(workspaceRoot: string, filepath: string): string {
  const relative = path.relative(workspaceRoot, filepath).replace(/\\/g, '/');
  return relative.split('/')[0] || '.';
}
