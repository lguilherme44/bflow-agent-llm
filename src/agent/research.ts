import { Span } from '@opentelemetry/api';
import { ReActAgent, ReActConfig } from './react-loop.js';
import { AgentState, ResearchBrief, DEFAULT_TOOL_BUDGETS } from '../types/index.js';
import { LLMResponseParser } from '../llm/adapter.js';
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
      toolBudget: DEFAULT_TOOL_BUDGETS.researcher,
      registry: researchRegistry,
      llmConfig: {
        ...config.llmConfig,
        systemPrompt: (config.llmConfig?.systemPrompt || '') + 
          `\n<role>Pesquisador: Leia arquivos e entenda o contexto.</role>` +
          `\n<rules>` +
          `\n- IDIOMA: PT-BR OBRIGATÓRIO.` +
          `\n- OBRIGATÓRIO: Use UMA ferramenta por resposta.` +
          `\n- FINALIZAR: Use 'submit_research_brief' para entregar o resultado.` +
          `\n- LOOP: Não leia o mesmo arquivo repetidamente. Se entendeu o conteúdo, finalize.` +
          `\n- VAZIO: Se não houver nada relevante, finalize IMEDIATAMENTE.` +
          `\n</rules>` +
          `\n<workflow>\n1. list_files/git_status\n2. retrieve_context (arquivos grandes) ou read_file (arquivos pequenos)\n3. submit_research_brief (FIM)\n</workflow>`
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

    if (!brief) {
      // Fallback: Check last assistant message for a JSON brief if tool call was missed or truncated
      const assistantMessages = state.messages.filter(m => m.role === 'assistant');
      for (let i = assistantMessages.length - 1; i >= 0; i--) {
        const content = assistantMessages[i].content;
        if (content && (content.includes('summary') || content.includes('title'))) {
          try {
            // We use the same parser logic to find JSON blocks
            const jsonText = LLMResponseParser.extractJson(content) || content;
            const parsedRaw = JSON.parse(jsonText.includes('{') ? jsonText.slice(jsonText.indexOf('{'), jsonText.lastIndexOf('}') + 1) : '{}');
            
            // Handle models that wrap the brief in a "ResearchBrief" or "brief" key
            const parsed = (parsedRaw.ResearchBrief || parsedRaw.brief || parsedRaw) as any;

            if (parsed.summary || parsed.taskType || parsed.Objetivo) {
              brief = {
                taskType: (parsed.taskType as any) || 'investigation',
                entryPoints: Array.isArray(parsed.entryPoints) ? parsed.entryPoints : (Array.isArray(parsed['Principais Arquivos']) ? parsed['Principais Arquivos'] : []),
                dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : [],
                risks: Array.isArray(parsed.risks) ? parsed.risks : [],
                summary: Array.isArray(parsed.summary) ? parsed.summary.join('\n') : String(parsed.summary || parsed.Objetivo || parsed.Contexto || '')
              };
              break;
            }
          } catch { /* ignore parsing errors in fallback */ }
        }
      }
    }

    return { state, brief };
  }
}
