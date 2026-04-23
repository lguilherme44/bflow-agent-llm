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

// ── TF-IDF Vectorizer ─────────────────────────────────────────

const VECTOR_DIM = 128;

/**
 * Minimal TF-IDF vectorizer that converts text into a fixed-length
 * numeric vector without any external model or GPU dependency.
 */
export class TfIdfVectorizer {
  private vocabulary = new Map<string, number>();
  private idf = new Map<string, number>();
  private fitted = false;

  /**
   * Build vocabulary and IDF weights from a corpus of documents.
   */
  fit(documents: string[]): void {
    const df = new Map<string, number>();
    const allTokens = new Set<string>();

    for (const doc of documents) {
      const tokens = this.tokenize(doc);
      const unique = new Set(tokens);
      for (const token of unique) {
        allTokens.add(token);
        df.set(token, (df.get(token) ?? 0) + 1);
      }
    }

    // Select top VECTOR_DIM tokens by document frequency
    const sorted = Array.from(df.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, VECTOR_DIM);

    this.vocabulary.clear();
    this.idf.clear();

    for (let i = 0; i < sorted.length; i++) {
      const [token, count] = sorted[i];
      this.vocabulary.set(token, i);
      this.idf.set(token, Math.log((documents.length + 1) / (count + 1)) + 1);
    }

    this.fitted = true;
  }

  /**
   * Transform a single text document into a fixed-length vector.
   */
  transform(text: string): Float32Array {
    const vector = new Float32Array(VECTOR_DIM);

    if (!this.fitted) {
      return vector;
    }

    const tokens = this.tokenize(text);
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    const maxTf = Math.max(1, ...Array.from(tf.values()));

    for (const [token, count] of tf.entries()) {
      const idx = this.vocabulary.get(token);
      if (idx !== undefined) {
        const normalizedTf = count / maxTf;
        const idfValue = this.idf.get(token) ?? 1;
        vector[idx] = normalizedTf * idfValue;
      }
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < VECTOR_DIM; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < VECTOR_DIM; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2 && t.length <= 40);
  }

  isFitted(): boolean {
    return this.fitted;
  }
}

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
  private readonly vectorizer = new TfIdfVectorizer();
  private readonly dbPath: string;
  private initialized = false;

  constructor(workspaceRoot: string) {
    this.dbPath = path.join(workspaceRoot, '.agent', 'vectordb');
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

    // Fit vectorizer on all chunk contents
    this.vectorizer.fit(chunks.map((c) => c.content));

    // Convert chunks to records
    const records: LanceDBChunkRecord[] = chunks.map((chunk) => ({
      id: chunk.id,
      content: chunk.content.slice(0, 4000), // Limit for storage efficiency
      filepath: chunk.metadata.filepath,
      language: chunk.metadata.language,
      symbols: chunk.metadata.symbols.join(' '),
      chunkKind: chunk.metadata.chunkKind,
      modifiedAt: chunk.metadata.modifiedAt,
      vector: this.vectorizer.transform(chunk.content),
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

    if (!this.table || !this.vectorizer.isFitted()) {
      return [];
    }

    const queryVector = this.vectorizer.transform(query);

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

  getVectorizer(): TfIdfVectorizer {
    return this.vectorizer;
  }
}
