import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { OrchestratorAgent } from './agent/orchestrator.js';
import { ContextManager } from './context/manager.js';
import { RouterLLMAdapter, LLMRouter } from './llm/router.js';
import { OllamaProvider, providerFromEnv } from './llm/providers.js';
import { UnifiedLogger } from './observability/logger.js';
import { TracingService } from './observability/tracing.js';
import { DashboardService } from './observability/dashboard-service.js';
import { CheckpointManager, FileCheckpointStorage } from './state/checkpoint.js';
import { createDevelopmentToolRegistry } from './tools/development-tools.js';
import { loadEnv } from './utils/env.js';

loadEnv();

const PORT = process.env.AGENT_SERVER_PORT ? parseInt(process.env.AGENT_SERVER_PORT) : 3030;
const workspaceRoot = process.cwd();

// Setup Agent Infrastructure
const registry = createDevelopmentToolRegistry({ workspaceRoot });
const checkpointStorage = new FileCheckpointStorage(path.join(workspaceRoot, '.agent', 'checkpoints'));
const checkpointManager = new CheckpointManager(checkpointStorage);
const contextManager = new ContextManager();
const logger = new UnifiedLogger({ logDirectory: path.join(workspaceRoot, '.agent', 'logs') });
const tracing = new TracingService({ 
  serviceName: 'agent-server',
  inMemoryExporter: true,
  consoleExporter: false 
});
const dashboard = new DashboardService(path.join(workspaceRoot, '.agent', 'logs'));

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
  tracing,
  humanApprovalCallback: async () => true, // Auto-approve for IDE integration
  llmConfig: {
    model: provider.defaultModel,
    temperature: 0.2,
  },
});

// Create Server
const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API ROUTES ---

  if (url === '/api/sessions' && req.method === 'GET') {
    const sessions = await dashboard.listSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessions));
    return;
  }

  if (url.match(/^\/api\/sessions\/[^/]+\/breakdown$/) && req.method === 'GET') {
    const agentId = url.split('/')[3];
    if (agentId) {
      const breakdown = await dashboard.getSessionBreakdown(agentId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(breakdown));
      return;
    }
  }

  if (url.startsWith('/api/sessions/') && req.method === 'GET') {
    const agentId = url.split('/').pop();
    if (agentId) {
      const logs = await dashboard.getSessionLogs(agentId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logs));
      return;
    }
  }

  if (url === '/api/sessions' && req.method === 'DELETE') {
    await dashboard.clearSessions();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (url.startsWith('/api/sessions/') && req.method === 'DELETE') {
    const agentId = url.split('/').pop();
    if (agentId) {
      await dashboard.deleteSession(agentId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }
  }

  if (url === '/api/metrics' && req.method === 'GET') {
    const stats = await dashboard.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  if (url === '/api/traces' && req.method === 'GET') {
    const spans = tracing.getFinishedSpans();
    // Sanitização para evitar erros de serialização (BigInt, circularidade)
    const sanitizedSpans = spans.map(span => ({
      name: span.name,
      context: span.spanContext(),
      parentSpanId: span.parentSpanId,
      kind: span.kind,
      startTime: span.startTime,
      endTime: span.endTime,
      attributes: span.attributes,
      status: span.status,
      events: span.events,
      duration: [
        span.endTime[0] - span.startTime[0],
        span.endTime[1] - span.startTime[1]
      ]
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sanitizedSpans, (_key, value) => 
      typeof value === 'bigint' ? value.toString() : value
    ));
    return;
  }

  // --- AGENT CHAT COMPLETIONS ---

  if (url === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const lastMessage = payload.messages[payload.messages.length - 1]?.content;
        const stream = payload.stream === true;

        if (!lastMessage) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'No message provided' }));
          return;
        }

        console.log(`[SERVER] Recebida tarefa: ${lastMessage} (Stream: ${stream})`);
        
        const chatId = `chatcmpl-${Date.now()}`;
        
        if (stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          const sendChunk = (content: string, finishReason: string | null = null) => {
            const chunk = {
              id: chatId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: provider.defaultModel,
              choices: [{
                index: 0,
                delta: content ? { content } : {},
                finish_reason: finishReason
              }]
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          };

          // Rodar o agente com callback de streaming
          await orchestrator.run(lastMessage, undefined, (event) => {
            if (event.type === 'phase_start') {
              sendChunk(`\n> **Fase: ${event.phase}**\n\n`);
            } else if (event.type === 'message_added') {
              if (event.role === 'assistant') {
                sendChunk(event.content);
              } else if (event.role === 'system' || event.role === 'tool') {
                // Opcional: mostrar logs técnicos formatados como blockquote ou similar
                // sendChunk(`\n> _${event.content}_\n\n`);
              }
            } else if (event.type === 'error') {
              sendChunk(`\n\n❌ **Erro: ${event.message}**\n`);
            }
          });

          // Se a orquestração terminou mas não enviamos nada (ou queremos garantir o final)
          sendChunk('', 'stop');
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          // Rodar o agente (Modo síncrono)
          const result = await orchestrator.run(lastMessage);
          const finalContent = result.state.messages
            .filter(m => m.role === 'assistant')
            .at(-1)?.content || 'Tarefa concluída sem resposta textual.';

          // Formato OpenAI
          const response = {
            id: chatId,
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
        }
      } catch (error: any) {
        console.error('[SERVER] Erro no processamento:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // --- DASHBOARD STATIC FILES ---

  if (url.startsWith('/dashboard') || url === '/') {
    try {
      let filePath = url === '/' || url === '/dashboard' ? 'index.html' : url.replace('/dashboard/', '');
      const fullPath = path.join(workspaceRoot, 'dashboard', 'dist', filePath);
      
      const content = await fs.readFile(fullPath);
      const ext = path.extname(fullPath);
      const contentType = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.svg': 'image/svg+xml',
      }[ext] || 'text/plain';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (error) {
      // If file not found and it's a dashboard route, serve index.html (SPA)
      if (url.startsWith('/dashboard')) {
        try {
            const indexContent = await fs.readFile(path.join(workspaceRoot, 'dashboard', 'dist', 'index.html'));
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(indexContent);
            return;
        } catch (e) {}
      }
      res.writeHead(404);
      res.end('Not Found');
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

// WebSocket Server for Real-time updates
const wss = new WebSocketServer({ server });

function broadcast(data: any) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Hook orchestrator events to WebSocket
orchestrator.setUpdateCallback((event) => {
  broadcast({ type: 'agent_update', event });
});

server.listen(PORT, () => {
  console.log(`\n🚀 AGENTE ONLINE (Modo Servidor)`);
  console.log(`📍 Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`📍 API: http://localhost:${PORT}/v1/chat/completions`);
  console.log(`🤖 Modelo: ${provider.defaultModel}`);
  console.log(`📂 Workspace: ${workspaceRoot}`);
  console.log(`\nConfigure o Continue.dev com apiBase: http://localhost:${PORT}/v1\n`);
});

