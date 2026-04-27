import readline from 'node:readline/promises';
import { OrchestratorAgent } from '../agent/orchestrator.js';
import picocolors from 'picocolors';
import { loadConfig, saveConfig, AgentConfig } from '../utils/config.js';
import { fetchOllamaModels, fetchLMStudioModels, pullOllamaModel, downloadLMStudioModel, LLMModel } from '../utils/llm-provider.js';
import { getSystemStats } from '../utils/system-stats.js';


export async function runRepl(
  orchestrator: OrchestratorAgent, 
  initialTask?: string,
  onReconnect?: () => Promise<OrchestratorAgent>
) {
  const commands = ['/connect', '/status', '/help', '/clear', 'exit', 'quit'];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line: string): [string[], string] => {
      const hits = commands.filter((c) => c.startsWith(line.toLowerCase()));
      return [hits, line];
    }

  });

  let currentOrchestrator = orchestrator;
  console.log(picocolors.cyan('\n--- AGENT CHAT MODE ---'));
  console.log(picocolors.dim('Digite sua tarefa ou use comandos (TAB para completar). Digite "/help" para ajuda.\n'));

  let currentTask = initialTask;

  async function handleCommand(command: string) {
    const args = command.split(' ');
    const cmd = args[0].toLowerCase();

    if (cmd === '/status') {
      const config = loadConfig();
      console.log(picocolors.cyan('\n--- CONFIGURAÇÃO ATUAL ---'));
      console.log(`${picocolors.bold('Provider:')} ${config.provider}`);
      console.log(`${picocolors.bold('Modelo:')} ${config.model || 'Padrão'}`);
      console.log(`${picocolors.bold('Base URL:')} ${config.baseUrl || 'Padrão'}`);
      console.log(`${picocolors.bold('Temperatura:')} ${config.temperature ?? 0.2}`);

      console.log(picocolors.cyan('\n--- ESTATÍSTICAS DE HARDWARE ---'));
      const stats = getSystemStats();
      
      // RAM
      console.log(`${picocolors.bold('RAM:')} ${stats.memory.usedGB} / ${stats.memory.totalGB} GB (${stats.memory.percent}%)`);
      
      // CPU
      const cpuLoad = stats.cpu.load ? ` [${stats.cpu.load}]` : '';
      console.log(`${picocolors.bold('CPU:')} ${stats.cpu.model}${cpuLoad}`);

      // GPU
      if (stats.gpu) {
        console.log(`${picocolors.bold('GPU:')} ${stats.gpu.name}`);
        console.log(`     Utilização: ${picocolors.yellow(stats.gpu.utilization)}`);
        console.log(`     VRAM: ${stats.gpu.vramUsed} / ${stats.gpu.vramTotal} (${stats.gpu.vramPercent})`);
      } else {
        console.log(`${picocolors.bold('GPU:')} Não detectada ou sem suporte (nvidia-smi)`);
      }

      console.log('---------------------------\n');
      return true;
    }

    if (cmd === '/clear') {
      console.clear();
      console.log(picocolors.cyan('--- AGENT CHAT MODE (Limpado) ---'));
      return true;
    }

    if (cmd === '/connect') {
      console.log(picocolors.cyan('\n--- CONFIGURAR CONEXÃO ---'));
      console.log('Escolha o provider:');
      console.log('1. OpenAI');
      console.log('2. Anthropic');
      console.log('3. Ollama');
      console.log('4. LM Studio');
      console.log('5. OpenRouter');
      
      const choice = await rl.question('Opção (1-5): ');
      const providers: AgentConfig['provider'][] = ['openai', 'anthropic', 'ollama', 'lmstudio', 'openrouter'];
      const provider = providers[parseInt(choice) - 1];

      if (!provider) {
        console.log(picocolors.red('Opção inválida.\n'));
        return true;
      }

      let model = '';
      let models: LLMModel[] = [];

      if (provider === 'ollama') {
        console.log(picocolors.dim('Buscando modelos do Ollama...'));
        models = await fetchOllamaModels();
      } else if (provider === 'lmstudio') {
        console.log(picocolors.dim('Buscando modelos do LM Studio...'));
        models = await fetchLMStudioModels();
      }

      if (models.length > 0) {
        console.log(picocolors.cyan('\nModelos disponíveis:'));
        models.forEach((m, i) => {
          const sizeStr = m.size ? ` (${(m.size / 1024 / 1024 / 1024).toFixed(2)} GB)` : '';
          console.log(`${picocolors.bold(i + 1)}. ${m.name}${sizeStr}`);
        });
        console.log(`${picocolors.bold(models.length + 1)}. [Baixar novo modelo...]`);
        console.log(`${picocolors.bold(models.length + 2)}. [Digitar manualmente]`);

        const modelChoice = await rl.question(`\nEscolha o modelo (1-${models.length + 2}): `);
        const idx = parseInt(modelChoice) - 1;

        if (idx >= 0 && idx < models.length) {
          model = models[idx].id;
        } else if (idx === models.length) {
          const newModelName = await rl.question('Nome do modelo para baixar (ex: llama3, qwen2.5-coder): ');
          if (newModelName) {
            console.log(picocolors.yellow(`\nBaixando ${newModelName}... Isso pode demorar.`));
            const success = provider === 'ollama' 
              ? await pullOllamaModel(newModelName) 
              : await downloadLMStudioModel(newModelName);
            
            if (success) {
              console.log(picocolors.green('Download concluído!'));
              model = newModelName;
            } else {
              console.log(picocolors.red('Falha ao iniciar download ou servidor não suporta.'));
              model = await rl.question('Modelo (manual): ');
            }
          }
        } else if (idx === models.length + 1) {
          model = await rl.question('Modelo: ');
        }
      } else {
        if (provider === 'ollama' || provider === 'lmstudio') {
          console.log(picocolors.yellow('Nenhum modelo detectado. Certifique-se que o provider está rodando.'));
        }
        model = await rl.question('Modelo (deixe em branco para o padrão): ');
      }

      const baseUrl = await rl.question('Base URL (deixe em branco para o padrão): ');
      
      const newConfig: Partial<AgentConfig> = { provider };
      if (model) newConfig.model = model;
      if (baseUrl) newConfig.baseUrl = baseUrl;


      saveConfig(newConfig);
      
      if (onReconnect) {
        console.log(picocolors.yellow('\nReconectando ao novo provider...'));
        currentOrchestrator = await onReconnect();
        console.log(picocolors.green('Conexão atualizada com sucesso!\n'));
      } else {
        console.log(picocolors.green('\nConfiguração salva! Reinicie o chat para aplicar totalmente.\n'));
      }
      
      return true;
    }

    if (cmd === '/help') {
      console.log(picocolors.cyan('\n--- COMANDOS DISPONÍVEIS (Use TAB para completar) ---'));
      console.log(`${picocolors.bold(picocolors.green('/connect'))} - Configura o provedor e modelo de LLM`);
      console.log(`${picocolors.bold(picocolors.green('/status'))}  - Mostra a configuração e provedor atual`);
      console.log(`${picocolors.bold(picocolors.green('/clear'))}   - Limpa a tela do terminal`);
      console.log(`${picocolors.bold(picocolors.green('/help'))}    - Mostra esta lista de comandos`);
      console.log(`${picocolors.bold(picocolors.green('exit'))}     - Encerra a sessão do agente`);
      console.log('------------------------------------------------------\n');
      return true;
    }

    return false;
  }


  // Se houver uma tarefa inicial (passada via CLI), executa ela primeiro
  if (currentTask) {
    console.log(picocolors.yellow(`Executando tarefa inicial: ${currentTask}`));
    await currentOrchestrator.run(currentTask);
    currentTask = undefined;
  }

  while (true) {
    const input = await rl.question(picocolors.bold(picocolors.green('Você > ')));
    
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log(picocolors.cyan('\nAt logo! 👋'));
      break;
    }

    if (!input.trim()) continue;

    if (input.startsWith('/')) {
      const handled = await handleCommand(input);
      if (handled) continue;
    }

    console.log(picocolors.dim(`\n--- ${new Date().toLocaleTimeString()} ---`));
    
    try {
      let currentPhase = '';
      let lastUsage = { totalTokens: 0 };
      let spinnerIdx = 0;
      const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      
      const progressInterval = setInterval(() => {
        if (currentPhase) {
          const frame = spinnerFrames[spinnerIdx % spinnerFrames.length];
          process.stdout.write(`\r  ${picocolors.cyan(frame)} ${picocolors.bold(currentPhase)} ${picocolors.dim(`| ${lastUsage.totalTokens.toLocaleString()} tokens`)}   `);
          spinnerIdx++;
        }
      }, 120);

      const result = await currentOrchestrator.run(input, undefined, (event) => {
        if (event.type === 'phase_start') {
          currentPhase = event.phase;
          if (event.phase === 'Chat' || event.phase === 'Resposta Direta') {
            clearInterval(progressInterval);
          }
        } else if (event.type === 'phase_complete') {
          currentPhase = '';
        } else if (event.type === 'usage_update') {
          lastUsage = event.usage;
        } else if (event.type === 'message_added' && event.role === 'assistant') {
          clearInterval(progressInterval);
          process.stdout.write('\r' + ' '.repeat(60) + '\r'); // Clear spinner line
          console.log(picocolors.green(`\n🤖 ${event.content.slice(0, 500)}${event.content.length > 500 ? '...' : ''}`));
          
          if (event.usage) {
            console.log(picocolors.dim(`   📊 ${event.usage.totalTokens.toLocaleString()} tokens | ${event.latencyMs || 0}ms`));
          }
        } else if (event.type === 'error') {
          process.stdout.write('\r' + ' '.repeat(60) + '\r');
          console.error(picocolors.red(`\n❌ ${event.message}`));
        }
      });
      
      clearInterval(progressInterval);
      process.stdout.write('\r' + ' '.repeat(60) + '\r'); // Clear spinner line
      
      if (result.state.status === 'completed') {
        // O resumo final já é notificado pelo orchestrator via callback se estiver configurado,
        // mas aqui garantimos que o usuário veja a resposta final.
        const lastAssistantMessage = result.state.messages.filter(m => m.role === 'assistant').at(-1);
        if (lastAssistantMessage) {
           // Se o orchestrator já logou, evitamos duplicar, mas o REPL precisa ser explícito
           // console.log(picocolors.green(`\nAgente > ${lastAssistantMessage.content}\n`));
        }
      } else if (result.state.status === 'error') {
        console.error(picocolors.red(`\nErro: ${result.state.metadata.errorMessage}\n`));
      }
    } catch (error) {
      console.error(picocolors.red(`\nFalha na execuo: ${error instanceof Error ? error.message : String(error)}\n`));
    }
  }

  rl.close();
}

