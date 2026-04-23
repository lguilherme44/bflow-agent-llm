import { Span } from '@opentelemetry/api';
import { ReActAgent, ReActConfig } from './react-loop.js';
import { AgentState, ResearchBrief } from '../types/index.js';
import { createTool } from '../tools/schema.js';
import { ToolRegistry } from '../tools/registry.js';

export class ResearchAgent {
  private reactAgent: ReActAgent;

  constructor(config: ReActConfig) {
    // Clone registry to inject the specific completion tool
    const researchRegistry = new ToolRegistry();
    
    // Copy all read-only tools and complete_task from the original registry
    const essentialTools = [
      'read_file', 
      'list_files', 
      'search_text', 
      'parse_file_ast', 
      'search_code', 
      'retrieve_context', 
      'git_status',
      'run_command',
      'execute_command',
      'repo_browser'
    ];
    for (const toolName of essentialTools) {
      const tool = config.registry.get(toolName);
      if (tool) {
        researchRegistry.register(tool);
      }
    }

    // Register a specific tool to submit the research brief
    researchRegistry.register(
      createTool()
        .name('submit_research_brief')
        .summary('Submit the completed research brief')
        .description('Use this tool to submit your findings and complete the research phase.')
        .whenToUse('Use when you have gathered enough context to produce a complete ResearchBrief.')
        .expectedOutput('Completion of the research phase.')
        .parameters({
          type: 'object',
          properties: {
            taskType: { type: 'string', enum: ['bugfix', 'feature', 'refactor', 'test', 'investigation', 'documentation'] },
            entryPoints: { type: 'array', items: { type: 'string' } },
            dependencies: { type: 'array', items: { type: 'string' } },
            risks: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
          required: ['taskType', 'entryPoints', 'dependencies', 'risks', 'summary'],
          additionalProperties: false,
        })
        .example('Submit brief', {
          taskType: 'feature',
          entryPoints: ['src/index.ts'],
          dependencies: ['react', 'zod'],
          risks: ['Might break existing routing'],
          summary: 'The new feature requires adding a route and a component.'
        })
        .handler(async (args) => {
          return { brief: args, completed: true, status: 'success' };
        })
        .build()
    );

    this.reactAgent = new ReActAgent({
      ...config,
      registry: researchRegistry,
      llmConfig: {
        ...config.llmConfig,
        systemPrompt: (config.llmConfig?.systemPrompt || '') + 
          `\n\nVocê é um Agente de Pesquisa. Sua missão é ler arquivos e entender o contexto para responder à tarefa.` +
          `\nREGRAS CRÍTICAS:` +
          `\n1. FALE APENAS EM PORTUGUÊS (PT-BR).` +
          `\n2. Use a ferramenta 'submit_research_brief' para finalizar sua fase. VOCÊ SÓ PODE TERMINAR USANDO ESTA FERRAMENTA.` +
          `\n3. USE SEMPRE OS CAMINHOS EXATOS RETORNADOS PELAS FERRAMENTAS. NÃO ADICIONE NEM REMOVA PREFIXOS DE DIRETÓRIO.` +
          `\n4. COMECE SEMPRE por 'list_files' ou 'git_status' para descobrir a estrutura do projeto.` +
          `\n5. SÓ USE 'search_text' DEPOIS de ter um termo concreto para buscar. O campo 'query' NUNCA pode ser vazio.` +
          `\n6. Se não souber o que pesquisar, leia um arquivo relevante (ex: README.md, package.json, TODO.md) com 'read_file'.` +
          `\n\nESTRATÉGIA DE PESQUISA RECOMENDADA:` +
          `\n- Passo 1: list_files para ver a estrutura do projeto` +
          `\n- Passo 2: read_file em arquivos-chave (README, package.json, etc.)` +
          `\n- Passo 3: search_text com termos específicos quando necessário` +
          `\n- Passo 4: submit_research_brief com suas conclusões`
      }
    });
  }

  async run(task: string, existingState?: AgentState, parentSpan?: Span): Promise<{ state: AgentState; brief: ResearchBrief | null }> {
    const researchTask = `Research the following task and provide a ResearchBrief:\n\n${task}`;
    const state = await this.reactAgent.run(researchTask, existingState, parentSpan);

    let brief: ResearchBrief | null = null;
    // Look for the submit_research_brief in tool history or wait for complete_task?
    // The ReActAgent will end the loop when `completed: true` is returned by the tool.
    // Let's search the tool history for `submit_research_brief`.
    for (let i = state.toolHistory.length - 1; i >= 0; i--) {
      const exec = state.toolHistory[i];
      if (exec.call.toolName === 'submit_research_brief' && exec.result.success) {
        brief = exec.call.arguments as unknown as ResearchBrief;
        break;
      }
    }

    return { state, brief };
  }
}
