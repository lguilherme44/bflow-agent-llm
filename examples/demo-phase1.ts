import { ReActAgent } from '../src/agent/react-loop';
import { ContextManager } from '../src/context/manager';
import { OpenAILLMAdapter } from '../src/llm/providers';
import { CheckpointManager, FileCheckpointStorage } from '../src/state/checkpoint';
import { createDevelopmentToolRegistry } from '../src/tools/development-tools';
import * as path from 'node:path';
import * as readline from 'node:readline';

// Demo End-to-End da Fase 1 - Pausa e Retomada (HITL)
// 
// Roteiro Manual para testar:
// 1. Configure OPENAI_API_KEY no seu ambiente.
// 2. Execute `npx ts-node examples/demo-phase1.ts`.
// 3. O agente pedirá para listar arquivos ou ler um arquivo.
// 4. Quando o agente tentar uma tool perigosa (ex: write_file), ele vai pausar.
// 5. O processo será finalizado, mas o estado salvo no .agent-checkpoints.
// 6. Você poderá rodar novamente para retomar do mesmo ponto aprovando a ação.

async function runDemo() {
  const workspaceDir = process.cwd();
  console.log('--- Iniciando Demo da Fase 1 ---');
  console.log(`Workspace: ${workspaceDir}`);

  // Configurar Registry de Tools (com write_file requerendo HITL)
  const registry = createDevelopmentToolRegistry({ workspaceRoot: workspaceDir });
  
  // Storage de Checkpoints
  const checkpointDir = path.join(workspaceDir, '.agent-checkpoints');
  const checkpointManager = new CheckpointManager(new FileCheckpointStorage(checkpointDir));
  
  // Adapter LLM (você pode trocar por MockLLMAdapter para offline test)
  const apiKey = process.env.OPENAI_API_KEY || 'fake-key-para-demo';
  const llm = new OpenAILLMAdapter({ apiKey, model: 'gpt-4o' });

  // Callbacks para Human in the loop
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  const humanApprovalCallback = async (toolName: string, args: any): Promise<boolean> => {
    return new Promise((resolve) => {
      rl.question(`[HITL] O agente quer executar '${toolName}' com args: ${JSON.stringify(args, null, 2)}.\nAprovar? (s/n): `, (answer) => {
        resolve(answer.toLowerCase() === 's');
      });
    });
  };

  const agent = new ReActAgent({
    llm,
    registry,
    checkpointManager,
    contextManager: new ContextManager(),
    humanApprovalCallback,
  });

  // Tenta retomar se houver checkpoint pendente (para simular reinício de processo)
  const activeCheckpoints = await checkpointManager.list({ statusIncludes: 'awaiting_human' });
  
  if (activeCheckpoints.length > 0) {
    console.log(`\nEncontrado checkpoint pendente (ID: ${activeCheckpoints[0].id}). Retomando...`);
    const currentState = await checkpointManager.get(activeCheckpoints[0].id);
    
    // Mostra o que estava pendente e pede aprovação
    if (currentState && currentState.pendingHumanApproval && !currentState.pendingHumanApproval.resolved) {
      const { toolName, args } = currentState.pendingHumanApproval.toolCall;
      const approved = await humanApprovalCallback(toolName, args);
      
      const resumedState = await agent.resume(currentState.id, 'User provided input on restart', approved);
      console.log(`Agente completado com status: ${resumedState.status}`);
    }
  } else {
    // Nova Execução
    console.log('\nIniciando nova task...');
    const initialState = await agent.run('Crie um arquivo chamado hello.txt contendo "Hello Fase 1" na raiz do projeto.');
    console.log(`Agente parou/completou com status: ${initialState.status}`);
    
    if (initialState.status === 'awaiting_human') {
      console.log('\nO agente pausou pedindo aprovação (perfeito para HITL).');
      console.log('Execute o script novamente para ver a retomada em ação!');
    }
  }

  rl.close();
}

runDemo().catch(console.error);
