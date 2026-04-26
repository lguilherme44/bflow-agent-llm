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
import { LanceDBStore } from './lancedb-store.js';
import { EmbeddingProvider, TfIdfEmbeddingProvider, OllamaEmbeddingProvider } from './embeddings.js';

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
  private readonly vectorStore: LanceDBStore;

  constructor(
    private readonly workspaceRoot = process.cwd(),
    private readonly parser = new TreeSitterParserService(),
    embeddingProvider?: EmbeddingProvider
  ) {
    const provider = embeddingProvider || this.resolveDefaultProvider();
    this.vectorStore = new LanceDBStore(workspaceRoot, provider);
  }

  private resolveDefaultProvider(): EmbeddingProvider {
    const type = process.env.EMBEDDING_PROVIDER || 'tf-idf';
    
    if (type === 'ollama') {
      return new OllamaEmbeddingProvider(
        768,
        process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
        process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
      );
    }

    return new TfIdfEmbeddingProvider();
  }

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
      try {
        const changed = await this.indexFile(filepath);
        if (changed) {
          filesIndexed += 1;
        } else {
          skippedFiles += 1;
        }
      } catch {
        // Individual file indexing failure is non-fatal — skip and continue
        skippedFiles += 1;
      }
    }

    this.rebuildLunrIndex();
    await this.syncVectorStore();

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
    return this.retrieveSync(input);
  }

  /**
   * Async retrieve that includes LanceDB vector search results.
   */
  async retrieveHybrid(input: RetrieveContextInput): Promise<RetrievalResult[]> {
    const limit = input.limit ?? 8;
    const filteredChunks = Array.from(this.chunks.values()).filter((chunk) =>
      this.matchesFilters(chunk, input.filters)
    );

    if (filteredChunks.length === 0) return [];

    // 1. Lexical Search (lunr)
    const lexicalResults = this.lexicalSearch(input.task, input.filters);

    // 2. Recency Ranking
    const recencyResults = this.recencyRank(filteredChunks).slice(0, 20);

    // 3. Centrality Ranking
    const centralityResults = this.centralityRank(filteredChunks).slice(0, 20);

    // 4. Vector Search (LanceDB)
    const vectorResults = await this.vectorSearch(input.task, input.filters, limit * 2);

    // 5. Filename Match Ranking
    const filenameResults = this.filenameRank(filteredChunks, input.task);

    // 6. Combine with RRF
    const combined = RankingUtils.rrf([lexicalResults, recencyResults, centralityResults, vectorResults, filenameResults]);

    return combined.slice(0, limit).map(({ item, score }) => {
      const reasons: string[] = [];
      if (lexicalResults.includes(item)) reasons.push('lexical match');
      if (recencyResults.slice(0, 10).includes(item)) reasons.push('recent file');
      if (centralityResults.slice(0, 10).includes(item)) reasons.push('structural centrality');
      if (vectorResults.includes(item)) reasons.push('vector similarity');
      if (filenameResults.slice(0, 5).includes(item)) reasons.push('filename match');

      return { chunk: item, score, reasons };
    });
  }

  /**
   * Reranks retrieval results using a more expensive semantic comparison.
   * Currently uses a boosted symbol match, but can be extended to use an LLM.
   */
  async rerankResults(results: RetrievalResult[], query: string): Promise<RetrievalResult[]> {
    if (results.length <= 1) return results;

    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
    
    return RankingUtils.rerank(
      results.map(r => ({ item: r, score: r.score })),
      query,
      async (res) => {
        let boost = res.score;
        
        // Semantic boost: if query terms appear in chunk symbols
        for (const term of terms) {
          if (res.chunk.metadata.symbols.some(s => s.toLowerCase().includes(term))) {
            boost += 0.2;
          }
        }

        // Penalty for too many tokens if not highly relevant
        if (res.chunk.tokensEstimate > 1000 && boost < 0.5) {
          boost -= 0.1;
        }

        return boost;
      }
    ).then(items => items.map(i => i.item));
  }

  /**
   * Compresses retrieved chunks by extracting only the most relevant parts
   * or summarizing them. (Placeholder for LLM-based compression).
   */
  async compressResults(results: RetrievalResult[]): Promise<RetrievalResult[]> {
    return results.map(res => {
      if (res.chunk.content.length < 1000) return res;

      // Simple heuristic compression: keep first 500 and last 500 chars if large
      // In a real scenario, this would call an LLM to summarize.
      const compressedContent = res.chunk.content.length > 2000
        ? res.chunk.content.slice(0, 800) + '\n\n[...]\n\n' + res.chunk.content.slice(-800)
        : res.chunk.content;

      return {
        ...res,
        chunk: {
          ...res.chunk,
          content: compressedContent,
          tokensEstimate: estimateTokensFromText(compressedContent)
        },
        reasons: [...res.reasons, 'compressed']
      };
    });
  }

  /**
   * Synchronous retrieve using lexical, recency, and centrality (no vector search).
   * Kept for backward compatibility.
   */
  private retrieveSync(input: RetrieveContextInput): RetrievalResult[] {
    const limit = input.limit ?? 8;
    const filteredChunks = Array.from(this.chunks.values()).filter((chunk) =>
      this.matchesFilters(chunk, input.filters)
    );

    if (filteredChunks.length === 0) return [];

    const lexicalResults = this.lexicalSearch(input.task, input.filters);
    const recencyResults = this.recencyRank(filteredChunks).slice(0, 20);
    const centralityResults = this.centralityRank(filteredChunks).slice(0, 20);
    const filenameResults = this.filenameRank(filteredChunks, input.task);

    const combined = RankingUtils.rrf([lexicalResults, recencyResults, centralityResults, filenameResults]);
    
    return combined.slice(0, limit).map(({ item, score }) => {
      const reasons: string[] = [];
      if (lexicalResults.includes(item)) reasons.push('lexical match');
      if (recencyResults.slice(0, 10).includes(item)) reasons.push('recent file');
      if (centralityResults.slice(0, 10).includes(item)) reasons.push('structural centrality');
      if (filenameResults.slice(0, 5).includes(item)) reasons.push('filename match');
      
      return { chunk: item, score, reasons };
    });
  }

  private lexicalSearch(task: string, filters: RetrieveContextInput['filters']): RetrievalChunk[] {
    const results: RetrievalChunk[] = [];
    if (this.lunrIndex) {
      try {
        const hits = this.lunrIndex.search(task);
        for (const hit of hits) {
          const chunk = this.chunks.get(hit.ref);
          if (chunk && this.matchesFilters(chunk, filters)) {
            results.push(chunk);
          }
        }
      } catch {
        // lunr throws on certain query patterns — degrade gracefully
      }
    }
    return results;
  }

  private recencyRank(chunks: RetrievalChunk[]): RetrievalChunk[] {
    return [...chunks].sort((a, b) => {
      const dateA = new Date(a.metadata.modifiedAt).getTime();
      const dateB = new Date(b.metadata.modifiedAt).getTime();
      return dateB - dateA;
    });
  }

  private centralityRank(chunks: RetrievalChunk[]): RetrievalChunk[] {
    return [...chunks].sort((a, b) => {
      const scoreA = (a.metadata.owner === 'src' ? 10 : 0) + a.metadata.symbols.length;
      const scoreB = (b.metadata.owner === 'src' ? 10 : 0) + b.metadata.symbols.length;
      return scoreB - scoreA;
    });
  }

  private filenameRank(chunks: RetrievalChunk[], query: string): RetrievalChunk[] {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return [];

    return chunks
      .filter(chunk => {
        const filepath = chunk.metadata.filepath.toLowerCase();
        return terms.some(term => filepath.includes(term));
      })
      .sort((a, b) => {
        const filepathA = a.metadata.filepath.toLowerCase();
        const filepathB = b.metadata.filepath.toLowerCase();
        
        // Count how many terms match in the path
        const matchesA = terms.filter(t => filepathA.includes(t)).length;
        const matchesB = terms.filter(t => filepathB.includes(t)).length;
        
        if (matchesB !== matchesA) return matchesB - matchesA;
        
        // Tie-breaker: shorter path (usually more "root" or direct)
        return filepathA.length - filepathB.length;
      });
  }

  private async vectorSearch(
    query: string,
    filters: RetrieveContextInput['filters'],
    limit: number
  ): Promise<RetrievalChunk[]> {
    try {
      const vectorResults = await this.vectorStore.search(query, limit);
      return vectorResults
        .map((vr) => this.chunks.get(vr.id))
        .filter((chunk): chunk is RetrievalChunk => chunk != null && this.matchesFilters(chunk, filters));
    } catch {
      return [];
    }
  }

  /**
   * Sync all in-memory chunks to the LanceDB vector store.
   */
  private async syncVectorStore(): Promise<void> {
    const allChunks = Array.from(this.chunks.values());
    if (allChunks.length === 0) return;

    try {
      await this.vectorStore.upsert(allChunks);
    } catch {
      // Vector store sync failure is non-fatal — lexical search still works
    }
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

    let document;
    try {
      document = this.parser.parseText(filepath, content);
    } catch {
      // Tree-sitter can crash on certain files (e.g. very large or binary-like content).
      // Fall back to a raw text chunk so indexing continues.
      return [
        this.makeChunk(filepath, content.slice(0, 8_000), contentHash, {
          filepath,
          language,
          symbols: [],
          imports: [],
          exports: [],
          modifiedAt,
          owner: ownerFromPath(filepath),
          module: moduleFromPath(this.workspaceRoot, filepath),
          chunkKind: 'file',
        }),
      ];
    }

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
    const ignored = new Set(['node_modules', 'dist', '.git', '.agent', '.agent-checkpoints', '.checkpoints', 'build', 'out']);

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
