import { ReActAgent, ReActConfig } from './react-loop.js';
import { AgentState, ResearchBrief } from '../types/index.js';
import { createTool } from '../tools/schema.js';
import { ToolRegistry } from '../tools/registry.js';

export class ResearchAgent {
  private reactAgent: ReActAgent;

  constructor(config: ReActConfig) {
    // Clone registry to inject the specific completion tool
    const researchRegistry = new ToolRegistry();
    
    // Copy all read-only tools from the original registry
    const readOnlyTools = ['read_file', 'list_files', 'search_text', 'parse_file_ast', 'search_code', 'retrieve_context'];
    for (const toolName of readOnlyTools) {
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
        systemPrompt: config.llmConfig?.systemPrompt + '\n\nYou are a Research Agent. Your goal is to use read-only tools to analyze the workspace, understand the user request, and finally call `submit_research_brief`. Do NOT write code or modify files.'
      }
    });
  }

  async run(task: string, existingState?: AgentState): Promise<{ state: AgentState; brief: ResearchBrief | null }> {
    const researchTask = `Research the following task and provide a ResearchBrief:\n\n${task}`;
    const state = await this.reactAgent.run(researchTask, existingState);

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
