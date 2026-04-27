import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { connect, type Connection, type Table } from '@lancedb/lancedb';
import { TfIdfEmbeddingProvider } from '../rag/embeddings.js';

interface ExperienceRecord {
  id: string;
  task: string;
  traceId: string;
  timestamp: string;
  vector: Float32Array;
}

export class ExperienceManager {
  private connection: Connection | null = null;
  private table: Table | null = null;
  private readonly dbPath: string;
  private initialized = false;
  private readonly embeddingProvider = new TfIdfEmbeddingProvider();

  constructor(workspaceRoot: string) {
    this.dbPath = path.join(workspaceRoot, '.agent', 'vectordb', 'experiences');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.dbPath, { recursive: true });
    this.connection = await connect(this.dbPath);

    const tableNames = await this.connection.tableNames();
    if (tableNames.includes('experiences')) {
      this.table = await this.connection.openTable('experiences');
    }

    this.initialized = true;
  }

  /**
   * Registra uma nova experiência bem-sucedida.
   */
  async addExperience(task: string, traceId: string): Promise<void> {
    await this.initialize();
    
    const vector = await this.embeddingProvider.embed(task);
    const record: ExperienceRecord = {
      id: traceId,
      task,
      traceId,
      timestamp: new Date().toISOString(),
      vector: new Float32Array(vector),
    };

    if (!this.connection) throw new Error('LanceDB not initialized');

    if (this.table) {
      await this.table.add([record]);
    } else {
      this.table = await this.connection.createTable('experiences', [record]);
    }
    
    console.log(`[ExperienceManager] Nova experiência registrada: ${task.slice(0, 50)}...`);
  }

  /**
   * Busca experiências similares para usar como exemplo (few-shot).
   */
  async searchSimilar(query: string, limit = 2): Promise<ExperienceRecord[]> {
    await this.initialize();
    if (!this.table) return [];

    const queryVector = await this.embeddingProvider.embed(query);
    
    try {
      const results = await this.table
        .search(queryVector)
        .limit(limit)
        .toArray();

      return results as unknown as ExperienceRecord[];
    } catch (error) {
      console.error('[ExperienceManager] Erro na busca:', error);
      return [];
    }
  }
}
