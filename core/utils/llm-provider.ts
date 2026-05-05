/**
 * Utilitários para interação com APIs locais de provedores de LLM (Ollama, LM Studio).
 */

export interface LLMModel {
  id: string;
  name: string;
  size?: number;
  description?: string;
}

/**
 * Busca modelos disponíveis no Ollama local ou remoto.
 */
export async function fetchOllamaModels(baseUrl: string = 'http://localhost:11434'): Promise<LLMModel[]> {
  try {
    const url = baseUrl.endsWith('/') ? `${baseUrl}api/tags` : `${baseUrl}/api/tags`;
    const response = await fetch(url);
    if (!response.ok) return [];
    
    const data = (await response.json()) as { models: any[] };
    return data.models.map(m => ({
      id: m.name,
      name: m.name,
      size: m.size,
    }));
  } catch (error) {
    return [];
  }
}

/**
 * Busca modelos disponíveis no LM Studio local ou remoto.
 */
export async function fetchLMStudioModels(baseUrl: string = 'http://localhost:1234/v1'): Promise<LLMModel[]> {
  try {
    const url = baseUrl.endsWith('/') ? `${baseUrl}models` : `${baseUrl}/models`;
    const response = await fetch(url);
    if (!response.ok) return [];
    
    const data = (await response.json()) as { data: any[] };
    return data.data.map(m => ({
      id: m.id,
      name: m.id,
    }));
  } catch (error) {
    return [];
  }
}

/**
 * Inicia o download de um modelo no Ollama.
 */
export async function pullOllamaModel(name: string, baseUrl: string = 'http://localhost:11434'): Promise<boolean> {
  try {
    const url = baseUrl.endsWith('/') ? `${baseUrl}api/pull` : `${baseUrl}/api/pull`;
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ name, stream: false }),
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Inicia o download de um modelo no LM Studio.
 */
export async function downloadLMStudioModel(name: string, baseUrl: string = 'http://localhost:1234/v1'): Promise<boolean> {
  try {
    const url = baseUrl.endsWith('/') ? `${baseUrl}models/download` : `${baseUrl}/models/download`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}
