import http from 'node:http';
import { OrchestratorAgent } from './agent/orchestrator.js';
import { ContextManager } from './context/manager.js';
import { RouterLLMAdapter, LLMRouter } from './llm/router.js';
import { OllamaProvider, providerFromEnv } from './llm/providers.js';
import { UnifiedLogger } from './observability/logger.js';
import { CheckpointManager, FileCheckpointStorage } from './state/checkpoint.js';
import { createDevelopmentToolRegistry } from './tools/development-tools.js';
import { loadEnv } from './utils/env.js';
import path from 'node:path';

loadEnv();

const PORT = process.env.AGENT_SERVER_PORT ? parseInt(process.env.AGENT_SERVER_PORT) : 3030;
const workspaceRoot = process.cwd();

// Setup Agent Infrastructure
const registry = createDevelopmentToolRegistry({ workspaceRoot });
const checkpointStorage = new FileCheckpointStorage(path.join(workspaceRoot, '.agent', 'checkpoints'));
const checkpointManager = new CheckpointManager(checkpointStorage);
const contextManager = new ContextManager();
const logger = new UnifiedLogger({ logDirectory: path.join(workspaceRoot, '.agent', 'logs') });

const providerName = (process.env.AGENT_LLM_PROVIDER || 'ollama') as any;
const provider = providerName === 'ollama' 
  ? new OllamaProvider({ defaultModel: process.env.AGENT_LLM_MODEL, baseUrl: process.env.AGENT_LLM_BASE_URL })
  : providerFromEnv(providerName);

const router = new LLMRouter([provider], {
  primaryProvider: provider.name,
  fallbackProviders: [],
  timeoutMs: 300000,
  taskModelPreferences: {},
});
const llm = new RouterLLMAdapter(router);

const orchestrator = new OrchestratorAgent({
  llm,
  registry,
  checkpointManager,
  contextManager,
  logger,
  humanApprovalCallback: async () => true, // Auto-approve for IDE integration
  llmConfig: {
    model: provider.defaultModel,
    temperature: 0.2,
  },
});

// Create Server
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const lastMessage = payload.messages[payload.messages.length - 1]?.content;

        if (!lastMessage) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'No message provided' }));
          return;
        }

        console.log(`[SERVER] Recebida tarefa do Continue: ${lastMessage}`);
        
        // Rodar o agente
        const result = await orchestrator.run(lastMessage);
        const finalContent = result.state.messages
          .filter(m => m.role === 'assistant')
          .at(-1)?.content || 'Tarefa concluída sem resposta textual.';

        // Formato OpenAI
        const response = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: provider.defaultModel,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: finalContent
            },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: result.state.metadata.totalTokensUsed
          }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (error: any) {
        console.error('[SERVER] Erro no processamento:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 AGENTE ONLINE (Modo Servidor)`);
  console.log(`📍 Endpoint: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`🤖 Modelo: ${provider.defaultModel}`);
  console.log(`📂 Workspace: ${workspaceRoot}`);
  console.log(`\nConfigure o Continue.dev com apiBase: http://localhost:${PORT}/v1\n`);
});
