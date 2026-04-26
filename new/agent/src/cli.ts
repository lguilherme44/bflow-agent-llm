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

loadEnv();

const program = new Command();

program
  .name('agent')
  .description('Checkpointable ReAct coding agent CLI')
  .version('1.0.0');

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
  let provider;
  const providerName = options.provider || process.env.AGENT_LLM_PROVIDER || 'lmstudio';
  
  if (providerName === 'lmstudio') {
    provider = new LMStudioProvider();
  } else if (providerName === 'ollama') {
    provider = new OllamaProvider({
      defaultModel: process.env.AGENT_LLM_MODEL,
      baseUrl: process.env.AGENT_LLM_BASE_URL
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
      console.log(picocolors.yellow(`\n[HITL] Aprovacao necessaria para: ${picocolors.bold(toolCall.toolName)}`));
      console.log(picocolors.dim(`Argumentos: ${JSON.stringify(toolCall.arguments, null, 2)}`));
      return true; // Auto-approve for CLI for now, but in a real scenario we'd ask.
    },
    llmConfig: {
      model: provider.defaultModel,
      temperature: 0.2
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
    const { checkpointManager } = await setupOrchestrator({});
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
  .option('-p, --provider <name>', 'Provider LLM (openai, anthropic, lmstudio, ollama)', 'lmstudio')
  .argument('[task...]', 'Tarefa inicial opcional')
  .action(async (taskArgs, options) => {
    const task = taskArgs.join(' ');
    const { orchestrator } = await setupOrchestrator(options);
    await runRepl(orchestrator, task || undefined);
  });

program
  .command('run')
  .description('Executa uma tarefa unica (one-shot)')
  .option('-p, --provider <name>', 'Provider LLM', 'lmstudio')
  .argument('<task...>', 'Descricao da tarefa')
  .action(async (taskArgs, options) => {
    const task = taskArgs.join(' ');
    const { orchestrator } = await setupOrchestrator(options);
    console.log(picocolors.cyan(`Executando tarefa: ${task}`));
    await orchestrator.run(task);
  });

program
  .command('resume')
  .description('Retoma uma sessao a partir de um ID')
  .option('-p, --provider <name>', 'Provider LLM', 'lmstudio')
  .argument('<id>', 'ID da sessao')
  .action(async (id, options) => {
    const { orchestrator, checkpointManager } = await setupOrchestrator(options);
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
