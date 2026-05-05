import { Agent } from '@openai/agents';
import { createOpenAITools } from './tools.js';

/**
 * Cria um agente único e direto para modelos locais com 8GB VRAM.
 * 
 * Decisão de design: Um único agente em vez de Planner+Coder.
 * Com modelos 7B, o overhead de handoff entre agentes desperdiça tokens
 * e frequentemente gera respostas malformadas. Um agente direto com todas
 * as ferramentas é mais eficiente e confiável.
 */
export function createSwarmAgents(workspaceRoot: string) {
  const tools = createOpenAITools({ workspaceRoot });

  const coderAgent = new Agent({
    name: 'Coder',
    instructions: [
      'Você é um engenheiro de software. Responda em PT-BR.',
      'REGRAS:',
      '1. SEMPRE use ferramentas para responder. NUNCA responda só com texto.',
      '2. Para explorar: use list_files, read_file_compact, search_text.',
      '3. Para editar: use edit_file ou create_file.',
      '4. Após editar, valide com execute_command (npm run build).',
      '5. Ao terminar, use complete_task com resumo em PT-BR.',
    ].join('\n'),
    tools: [
      tools.readFileTool,
      tools.readFileCompactTool,
      tools.listFilesTool,
      tools.searchTextTool,
      tools.executeCommandTool,
      tools.createFileTool,
      tools.editFileTool,
      tools.completeTaskTool,
    ],
    // Modelo local: forçar temperature baixa e resposta curta
    modelSettings: {
      temperature: 0.1,
      maxTokens: 2048,
    },
  });

  // O plannerAgent agora é o mesmo coderAgent (sem overhead de handoff)
  // Mantemos a interface para compatibilidade com o orchestrator
  return { plannerAgent: coderAgent, coderAgent };
}
