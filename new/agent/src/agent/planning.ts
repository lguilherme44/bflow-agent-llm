import { Span } from '@opentelemetry/api';
import { ReActAgent, ReActConfig } from './react-loop.js';
import { AgentState, ExecutionPlan, ResearchBrief } from '../types/index.js';
import { createTool } from '../tools/schema.js';
import { ToolRegistry } from '../tools/registry.js';

export class PlanningAgent {
  private reactAgent: ReActAgent;

  constructor(config: ReActConfig) {
    const planningRegistry = new ToolRegistry();
    
    // Planner shouldn't execute edits, only read context and plan
    const essentialTools = [
      'read_file', 
      'list_files', 
      'search_text', 
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
        planningRegistry.register(tool);
      }
    }

    planningRegistry.register(
      createTool()
        .name('submit_execution_plan')
        .summary('Submit the structured execution plan')
        .description('Use this tool to submit the planned execution streams and finish the planning phase.')
        .whenToUse('Use after you have created a comprehensive plan based on the ResearchBrief.')
        .expectedOutput('Completion of the planning phase.')
        .parameters({
          type: 'object',
          properties: {
            summary: { type: 'string' },
            estimatedRisk: { type: 'string', enum: ['low', 'medium', 'high'] },
            streams: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  owner: { type: 'string', enum: ['researcher', 'planner', 'orchestrator', 'coder', 'reviewer'] },
                  tasks: { type: 'array', items: { type: 'string' } },
                  validations: { type: 'array', items: { type: 'string' } },
                  blockedBy: { type: 'array', items: { type: 'string' } },
                },
                required: ['id', 'name', 'owner', 'tasks', 'validations'],
                additionalProperties: false,
              }
            }
          },
          required: ['summary', 'estimatedRisk', 'streams'],
          additionalProperties: false,
        })
        .example('Submit plan', {
          summary: 'Implementation plan for the new auth feature',
          estimatedRisk: 'medium',
          streams: [
            {
              id: 'stream-1',
              name: 'Backend API',
              owner: 'coder',
              tasks: ['Create route handler', 'Add Zod schema'],
              validations: ['Run unit tests', 'Typecheck'],
              blockedBy: []
            }
          ]
        })
        .handler(async (args) => {
          return { plan: args, completed: true, status: 'success' };
        })
        .build()
    );

    this.reactAgent = new ReActAgent({
      ...config,
      registry: planningRegistry,
      llmConfig: {
        ...config.llmConfig,
        systemPrompt: (config.llmConfig?.systemPrompt || '') + 
          `\n\nVocê é um Agente de Planejamento. Sua missão é criar um plano de execução seguro.` +
          `\nREGRAS CRÍTICAS:` +
          `\n1. FALE APENAS EM PORTUGUÊS (PT-BR).` +
          `\n2. Use a ferramenta 'submit_execution_plan' para finalizar sua fase. VOCÊ SÓ PODE TERMINAR USANDO ESTA FERRAMENTA.` +
          `\n3. USE SEMPRE OS CAMINHOS EXATOS RETORNADOS PELAS FERRAMENTAS. NÃO ADICIONE NEM REMOVA PREFIXOS DE DIRETÓRIO.`
      }
    });
  }

  async run(task: string, brief: ResearchBrief, existingState?: AgentState, parentSpan?: Span): Promise<{ state: AgentState; plan: ExecutionPlan | null }> {
    const planningTask = `Original Task:\n${task}\n\nResearch Brief:\n${JSON.stringify(brief, null, 2)}\n\nCreate a structured ExecutionPlan for this task.`;
    const state = await this.reactAgent.run(planningTask, existingState, parentSpan);

    let plan: ExecutionPlan | null = null;
    
    for (let i = state.toolHistory.length - 1; i >= 0; i--) {
      const exec = state.toolHistory[i];
      if (exec.call.toolName === 'submit_execution_plan' && exec.result.success) {
        // Map the raw arguments to the ExecutionPlan interface, adding status
        const rawPlan = exec.call.arguments as any;
        plan = {
          summary: rawPlan.summary,
          estimatedRisk: rawPlan.estimatedRisk,
          streams: rawPlan.streams.map((s: any) => ({
            ...s,
            status: 'pending'
          }))
        };
        break;
      }
    }

    return { state, plan };
  }

  static formatPlanAsMarkdown(plan: ExecutionPlan): string {
    let md = `## Execution Plan: ${plan.summary}\n`;
    md += `**Estimated Risk:** ${plan.estimatedRisk.toUpperCase()}\n\n`;

    for (const stream of plan.streams) {
      md += `### Stream ${stream.id} - ${stream.name} (Owner: ${stream.owner})\n`;
      if (stream.blockedBy && stream.blockedBy.length > 0) {
        md += `*Blocked by: ${stream.blockedBy.join(', ')}*\n`;
      }
      for (const task of stream.tasks) {
        md += `- [ ] ${task}\n`;
      }
      if (stream.validations.length > 0) {
        md += `\n**Validations:**\n`;
        for (const validation of stream.validations) {
          md += `- [ ] ${validation}\n`;
        }
      }
      md += `\n`;
    }

    return md;
  }
}
