export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

/**
 * TF-IDF Vectorizer — converts text into a fixed-length
 * numeric vector based on term frequency and document frequency.
 * Zero external dependencies.
 */
export class TfIdfEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'tf-idf';
  private vocabulary = new Map<string, number>();
  private idf = new Map<string, number>();
  private fitted = false;
  readonly dimensions: number;

  constructor(vectorDim = 128) {
    this.dimensions = vectorDim;
  }

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

    const sorted = Array.from(df.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.dimensions);

    this.vocabulary.clear();
    this.idf.clear();

    for (let i = 0; i < sorted.length; i++) {
      const [token, count] = sorted[i];
      this.vocabulary.set(token, i);
      this.idf.set(token, Math.log((documents.length + 1) / (count + 1)) + 1);
    }

    this.fitted = true;
  }

  async embed(text: string): Promise<Float32Array> {
    const vector = new Float32Array(this.dimensions);
    if (!this.fitted) return vector;

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

    this.l2Normalize(vector);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.fitted) {
      this.fit(texts);
    }
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  private l2Normalize(vector: Float32Array): void {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }
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

/**
 * Ollama Embedding Provider — uses local Ollama server to generate embeddings.
 * Default model is nomic-embed-text.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  
  constructor(
    readonly dimensions = 768,
    private readonly model = 'nomic-embed-text',
    private readonly baseUrl = 'http://127.0.0.1:11434'
  ) {}

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Ollama embedding failed: ${response.statusText} - ${errorBody}`);
      }

      const data = await response.json() as { embeddings: number[][] };
      return data.embeddings.map((emb) => new Float32Array(emb));
    } catch (error) {
      console.error('Failed to get embeddings from Ollama:', error);
      // Return zero vectors on failure to avoid crashing the RAG pipeline
      return texts.map(() => new Float32Array(this.dimensions));
    }
  }
}
