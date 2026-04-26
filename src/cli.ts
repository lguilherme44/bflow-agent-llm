#!/usr/bin/env node
import { Command } from 'commander';
import { OrchestratorAgent } from './agent/orchestrator.js';
import { ContextManager } from './context/manager.js';
import { CheckpointManager, FileCheckpointStorage } from './state/checkpoint.js';
import { createDevelopmentToolRegistry } from './tools/development-tools.js';
import { providerFromEnv, LMStudioProvider, OllamaProvider } from './llm/providers.js';
import { RouterLLMAdapter, LLMRouter } from './llm/router.js';
import { UnifiedLogger } from './observability/logger.js';
import { initProject } from './cli/init.js';
import { runRepl } from './cli/repl.js';
import path from 'node:path';
import picocolors from 'picocolors';
import { loadEnv } from './utils/env.js';
import { loadConfig } from './utils/config.js';

loadEnv();

const program = new Command();

program
  .name('agent')
  .description('Checkpointable ReAct coding agent CLI')
  .version('1.0.0')
  .option('-p, --provider <name>', 'Provider LLM (openai, anthropic, lmstudio, ollama)', 'lmstudio');

// Helper to setup the orchestrator
async function setupOrchestrator(options: any) {
  const workspaceRoot = process.cwd();
  const agentDir = path.join(workspaceRoot, '.agent');
  const checkpointStorage = new FileCheckpointStorage(path.join(agentDir, 'checkpoints'));
  const checkpointManager = new CheckpointManager(checkpointStorage);
  const registry = createDevelopmentToolRegistry({ workspaceRoot });
  const contextManager = new ContextManager();
  const logger = new UnifiedLogger({ logDirectory: path.join(agentDir, 'logs') });

  // Resolve Provider
  const config = loadConfig(workspaceRoot);
  let provider;
  const providerName = options.provider || config.provider || process.env.AGENT_LLM_PROVIDER || 'lmstudio';
  
  if (providerName === 'lmstudio') {
    provider = new LMStudioProvider({
      baseUrl: config.baseUrl || process.env.AGENT_LLM_BASE_URL,
      defaultModel: config.model || process.env.AGENT_LLM_MODEL
    });
  } else if (providerName === 'ollama') {
    provider = new OllamaProvider({
      defaultModel: config.model || process.env.AGENT_LLM_MODEL,
      baseUrl: config.baseUrl || process.env.AGENT_LLM_BASE_URL
    });
  } else {
    provider = providerFromEnv(providerName as any);
  }

  const router = new LLMRouter([provider], {
    primaryProvider: provider.name,
    fallbackProviders: [],
    timeoutMs: 300000,
    taskModelPreferences: {}
  });
  const llm = new RouterLLMAdapter(router);

  const orchestrator = new OrchestratorAgent({
    llm,
    registry,
    checkpointManager,
    contextManager,
    logger,
    humanApprovalCallback: async (toolCall) => {
      console.log(picocolors.yellow(`\n[HITL] Aprovação necessária para: ${picocolors.bold(toolCall.toolName)}`));
      console.log(picocolors.white(`Argumentos: ${JSON.stringify(toolCall.arguments, null, 2)}`));
      
      const rl = (await import('node:readline/promises')).createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      
      const answer = await rl.question(picocolors.cyan('Aprovar execução? (s/n): '));
      rl.close();
      
      return answer.toLowerCase() === 's';
    },
    llmConfig: {
      model: provider.defaultModel,
      temperature: config.temperature ?? 0.2,
      maxTokens: config.maxTokens ?? 2048
    }
  });

  orchestrator.setUpdateCallback((event) => {
    switch (event.type) {
      case 'phase_start':
        console.log(picocolors.cyan(`\n[FASE] ${event.phase}`));
        break;
      case 'message_added':
        if (event.role === 'assistant') {
          console.log(picocolors.green(`\nAgente > ${event.content}`));
        } else if (event.role === 'system') {
          console.log(picocolors.dim(`[SISTEMA] ${event.content}`));
        }
        break;
      case 'error':
        console.error(picocolors.red(`\n[ERRO] ${event.message}`));
        break;
    }
  });

  return { orchestrator, checkpointManager, logger };
}

program
  .command('init')
  .description('Inicializa um novo projeto para o agente')
  .action(async () => {
    await initProject(process.cwd());
  });

program
  .command('list')
  .description('Lista as sessoes e checkpoints salvos')
  .action(async () => {
    const { checkpointManager } = await setupOrchestrator(program.opts());
    const checkpoints = await checkpointManager.list();
    if (checkpoints.length === 0) {
      console.log('Nenhum checkpoint encontrado.');
      return;
    }

    console.log(picocolors.cyan('\n--- SESSOES DO AGENTE ---'));
    checkpoints.forEach((cp) => {
      const date = new Date(cp.updatedAt).toLocaleString('pt-BR');
      console.log(`${picocolors.bold(cp.id.slice(0, 8))} | ${cp.status.padEnd(10)} | ${date} | ${cp.currentTask?.slice(0, 50)}...`);
    });
  });

program
  .command('chat')
  .description('Inicia um chat interativo (REPL) com o agente')
  .argument('[task...]', 'Tarefa inicial opcional')
  .action(async (taskArgs, options) => {
    const task = taskArgs.join(' ');
    const { orchestrator } = await setupOrchestrator({ ...program.opts(), ...options });
    await runRepl(orchestrator, task || undefined, async () => {
      const { orchestrator: newOrchestrator } = await setupOrchestrator({ ...program.opts(), ...options });
      return newOrchestrator;
    });

  });

program
  .command('run')
  .description('Executa uma tarefa unica (one-shot)')
  .argument('<task...>', 'Descricao da tarefa')
  .action(async (taskArgs, options) => {
    const task = taskArgs.join(' ');
    const { orchestrator } = await setupOrchestrator({ ...program.opts(), ...options });
    console.log(picocolors.cyan(`Executando tarefa: ${task}`));
    await orchestrator.run(task);
  });

program
  .command('resume')
  .description('Retoma uma sessao a partir de um ID')
  .argument('<id>', 'ID da sessao')
  .action(async (id, options) => {
    const { orchestrator, checkpointManager } = await setupOrchestrator({ ...program.opts(), ...options });
    const state = await checkpointManager.resumeFromCheckpoint(id);
    if (!state) {
      console.error(picocolors.red(`Erro: Sessao ${id} nao encontrada.`));
      return;
    }
    console.log(picocolors.cyan(`Retomando sessao: ${id}`));
    await orchestrator.run(state.currentTask || 'Resuming...', state);
  });

// Default to help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parseAsync(process.argv);
}
