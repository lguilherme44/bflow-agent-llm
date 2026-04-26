import readline from 'node:readline/promises';
import { OrchestratorAgent } from '../agent/orchestrator.js';
import picocolors from 'picocolors';

export async function runRepl(orchestrator: OrchestratorAgent, initialTask?: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(picocolors.cyan('\n--- AGENT CHAT MODE ---'));
  console.log(picocolors.dim('Digite sua tarefa ou apenas converse. Digite "exit" ou "quit" para sair.\n'));

  let currentTask = initialTask;

  // Se houver uma tarefa inicial (passada via CLI), executa ela primeiro
  if (currentTask) {
    console.log(picocolors.yellow(`Executando tarefa inicial: ${currentTask}`));
    await orchestrator.run(currentTask);
    currentTask = undefined;
  }

  while (true) {
    const input = await rl.question(picocolors.bold(picocolors.green('Você > ')));
    
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log(picocolors.cyan('\nAt logo! 👋'));
      break;
    }

    if (!input.trim()) continue;

    console.log(picocolors.dim(`\n--- ${new Date().toLocaleTimeString()} ---`));
    
    try {
      const result = await orchestrator.run(input);
      
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
