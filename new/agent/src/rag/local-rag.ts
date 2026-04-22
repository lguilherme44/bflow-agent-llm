import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  CodeLanguage,
  RetrievalChunk,
  RetrievalChunkMetadata,
  RetrievalResult,
  SymbolReference,
} from '../types';
import { detectLanguage, hashContent } from '../code/source';
import { TreeSitterParserService } from '../code/tree-sitter-parser';
import { estimateTokensFromText } from '../utils/json';

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

  constructor(
    private readonly workspaceRoot = process.cwd(),
    private readonly parser = new TreeSitterParserService()
  ) {}

  async indexWorkspace(directory = '.'): Promise<RagIndexStats> {
    const files = await this.listIndexableFiles(path.resolve(this.workspaceRoot, directory));
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
    const queryVector = vectorize(input.task);
    const queryTerms = Object.keys(queryVector);
    const limit = input.limit ?? 8;

    return Array.from(this.chunks.values())
      .filter((chunk) => this.matchesFilters(chunk, input.filters))
      .map((chunk) => this.scoreChunk(chunk, queryVector, queryTerms))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
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
      vector: vectorize(`${content} ${metadata.symbols.join(' ')} ${metadata.filepath}`),
    };
  }

  private scoreChunk(
    chunk: RetrievalChunk,
    queryVector: Record<string, number>,
    queryTerms: string[]
  ): RetrievalResult {
    const lexicalScore = cosineSimilarity(queryVector, chunk.vector);
    const symbolScore = queryTerms.filter((term) =>
      chunk.metadata.symbols.some((symbol) => symbol.toLowerCase().includes(term))
    ).length;
    const filepathScore = queryTerms.filter((term) => chunk.metadata.filepath.toLowerCase().includes(term)).length;
    const recencyScore = recencyBoost(chunk.metadata.modifiedAt);
    const score = lexicalScore * 100 + symbolScore * 12 + filepathScore * 8 + recencyScore;
    const reasons: string[] = [];

    if (lexicalScore > 0) {
      reasons.push(`lexical/vector overlap ${lexicalScore.toFixed(3)}`);
    }
    if (symbolScore > 0) {
      reasons.push(`symbol match x${symbolScore}`);
    }
    if (filepathScore > 0) {
      reasons.push(`filepath match x${filepathScore}`);
    }
    if (recencyScore > 0) {
      reasons.push(`recent file boost ${recencyScore.toFixed(2)}`);
    }

    return { chunk, score, reasons };
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
}

function vectorize(text: string): Record<string, number> {
  const vector: Record<string, number> = {};
  for (const term of tokenize(text)) {
    vector[term] = (vector[term] ?? 0) + 1;
  }
  return vector;
}

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (const value of Object.values(a)) {
    aNorm += value * value;
  }

  for (const [term, value] of Object.entries(b)) {
    bNorm += value * value;
    dot += (a[term] ?? 0) * value;
  }

  if (aNorm === 0 || bNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length >= 2 && !STOP_WORDS.has(term));
}

function recencyBoost(modifiedAt: string): number {
  const ageMs = Date.now() - new Date(modifiedAt).getTime();
  const ageDays = ageMs / 86_400_000;
  return Math.max(0, 5 - ageDays / 30);
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

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'uma',
  'para',
  'com',
  'que',
  'this',
  'that',
  'from',
  'import',
  'export',
]);
