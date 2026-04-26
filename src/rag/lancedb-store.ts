/**
 * LanceDB Vector Store — persistent vector database for RAG retrieval.
 *
 * Uses TF-IDF vectorization to create embeddings locally (zero external deps).
 * The LanceDB tables are stored on disk at `{workspaceRoot}/.agent/vectordb/`.
 */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { connect, type Connection, type Table } from '@lancedb/lancedb';
import { RetrievalChunk } from '../types/index.js';

import { EmbeddingProvider, TfIdfEmbeddingProvider } from './embeddings.js';

// ── LanceDB Store ─────────────────────────────────────────────

interface LanceDBChunkRecord {
  id: string;
  content: string;
  filepath: string;
  language: string;
  symbols: string;
  chunkKind: string;
  modifiedAt: string;
  vector: Float32Array;
  [key: string]: string | Float32Array;
}

export interface VectorSearchResult {
  id: string;
  score: number;
}

export class LanceDBStore {
  private connection: Connection | null = null;
  private table: Table | null = null;
  private readonly dbPath: string;
  private initialized = false;

  constructor(
    workspaceRoot: string,
    private readonly embeddingProvider: EmbeddingProvider = new TfIdfEmbeddingProvider()
  ) {
    this.dbPath = path.join(workspaceRoot, '.agent', 'vectordb', embeddingProvider.name);
  }

  /**
   * Initialize the LanceDB connection and ensure the table exists.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await mkdir(this.dbPath, { recursive: true });
    this.connection = await connect(this.dbPath);

    const tableNames = await this.connection.tableNames();
    if (tableNames.includes('chunks')) {
      this.table = await this.connection.openTable('chunks');
    }

    this.initialized = true;
  }

  /**
   * Fit the vectorizer on all chunk contents and upsert them into LanceDB.
   */
  async upsert(chunks: RetrievalChunk[]): Promise<void> {
    await this.initialize();
    if (chunks.length === 0) return;

    // Fit vectorizer if needed (for TF-IDF) or just get embeddings
    // We truncate to 4000 chars to avoid context length issues in some models
    const embeddings = await this.embeddingProvider.embedBatch(chunks.map((c) => c.content.slice(0, 4000)));

    // Convert chunks to records
    const records: LanceDBChunkRecord[] = chunks.map((chunk, i) => ({
      id: chunk.id,
      content: chunk.content.slice(0, 4000), // Limit for storage efficiency
      filepath: chunk.metadata.filepath,
      language: chunk.metadata.language,
      symbols: chunk.metadata.symbols.join(' '),
      chunkKind: chunk.metadata.chunkKind,
      modifiedAt: chunk.metadata.modifiedAt,
      vector: embeddings[i],
    }));

    if (!this.connection) {
      throw new Error('LanceDB connection not initialized');
    }

    // Drop existing table and recreate with fresh data
    // (LanceDB optimizes this well for small-to-medium codebases)
    const tableNames = await this.connection.tableNames();
    if (tableNames.includes('chunks')) {
      await this.connection.dropTable('chunks');
    }

    this.table = await this.connection.createTable('chunks', records);
  }

  /**
   * Search for chunks similar to the given query text.
   */
  async search(query: string, limit = 10): Promise<VectorSearchResult[]> {
    await this.initialize();

    const queryVector = await this.embeddingProvider.embed(query);

    if (!this.table) {
      return [];
    }

    try {
      const results = await this.table
        .search(queryVector)
        .limit(limit)
        .toArray();

      return results.map((row) => ({
        id: row.id as string,
        score: 1.0 / (1.0 + (row._distance as number)), // Convert distance to similarity
      }));
    } catch {
      // Table may be empty or incompatible
      return [];
    }
  }

  /**
   * Delete chunks by their IDs.
   */
  async deleteByFilepath(filepath: string): Promise<void> {
    await this.initialize();
    if (!this.table) return;

    try {
      await this.table.delete(`filepath = '${filepath.replace(/'/g, "''")}'`);
    } catch {
      // Ignore errors for missing records
    }
  }

  /**
   * Get the total number of records in the store.
   */
  async count(): Promise<number> {
    await this.initialize();
    if (!this.table) return 0;

    try {
      return await this.table.countRows();
    } catch {
      return 0;
    }
  }

  getEmbeddingProvider(): EmbeddingProvider {
    return this.embeddingProvider;
  }
}
