import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';

export interface AgentConfig {
  provider: 'openai' | 'anthropic' | 'openrouter' | 'lmstudio' | 'ollama';
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  sandbox?: 'docker' | 'native' | 'auto';
}

const CONFIG_FILE = '.agentrc';

export function loadConfig(workspaceRoot: string = process.cwd()): AgentConfig {
  const configPath = path.join(workspaceRoot, CONFIG_FILE);
  
  if (!fs.existsSync(configPath)) {
    return {
      provider: (process.env.AGENT_LLM_PROVIDER as any) || 'lmstudio',
      model: process.env.AGENT_LLM_MODEL,
      baseUrl: process.env.AGENT_LLM_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY,
    };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content) as AgentConfig;
    
    // Basic validation
    const validProviders = ['openai', 'anthropic', 'openrouter', 'lmstudio', 'ollama'];
    if (!validProviders.includes(parsed.provider)) {
      console.warn(picocolors.yellow(`Aviso: Provider "${parsed.provider}" no ${CONFIG_FILE} é inválido. Usando "lmstudio" como fallback.`));
      parsed.provider = 'lmstudio';
    }

    return {
      ...parsed,
      // Priority: .agentrc value > .env value (handled by loadConfig returning the object)
      apiKey: parsed.apiKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY,
    };
  } catch (error) {
    console.error(picocolors.red(`Erro ao ler ou processar ${CONFIG_FILE}:`), error instanceof Error ? error.message : error);
    return { provider: 'lmstudio' };
  }
}

export function saveConfig(config: Partial<AgentConfig>, workspaceRoot: string = process.cwd()): void {
  const configPath = path.join(workspaceRoot, CONFIG_FILE);
  const current = loadConfig(workspaceRoot);
  const updated = { ...current, ...config };

  try {
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Erro ao salvar ${CONFIG_FILE}:`, error);
  }
}
