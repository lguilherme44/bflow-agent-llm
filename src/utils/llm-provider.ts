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
 * Busca modelos disponíveis no Ollama local.
 */
export async function fetchOllamaModels(): Promise<LLMModel[]> {
  try {
    const response = await fetch('http://localhost:11434/api/tags');
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
 * Busca modelos disponíveis no LM Studio local.
 */
export async function fetchLMStudioModels(): Promise<LLMModel[]> {
  try {
    const response = await fetch('http://localhost:1234/v1/models');
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
 * Nota: Ollama usa streaming para progresso, mas aqui simplificamos para aguardar ou apenas iniciar.
 */
export async function pullOllamaModel(name: string): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:11434/api/pull', {
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
export async function downloadLMStudioModel(name: string): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:1234/api/v1/models/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name }),
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}
