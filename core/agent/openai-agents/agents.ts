import { Agent } from '@openai/agents';
import { createOpenAITools } from './tools.js';
import type { LocalRuntimeProfile } from './runtime-profile.js';
import type { OpenAIToolRuntimeEvent } from '../../utils/file-utils.js';

export interface CreateSwarmAgentsOptions {
  runtimeProfile?: LocalRuntimeProfile;
  onToolEvent?: (event: OpenAIToolRuntimeEvent) => void;
}

/**
 * Creates one direct agent for small local coding models.
 *
 * A single agent avoids handoff overhead. This matters for 7B/8B models and
 * MLX setups where context budget and latency are the bottlenecks.
 */
export function createSwarmAgents(workspaceRoot: string, options: CreateSwarmAgentsOptions = {}) {
  const profile = options.runtimeProfile;
  const tools = createOpenAITools({
    workspaceRoot,
    runtimeLimits: profile
      ? {
          maxFileLines: profile.maxFileLines,
          maxListFiles: profile.maxListFiles,
          maxSearchMatches: profile.maxSearchMatches,
          maxRagResults: profile.maxRagResults,
        }
      : undefined,
    onToolEvent: options.onToolEvent,
  });

  const coderAgent = new Agent({
    name: 'Coder',
    instructions: [
      'Voce e um engenheiro de software. Responda em PT-BR.',
      'REGRAS:',
      '1. Sempre use ferramentas para explorar, editar ou validar codigo.',
      '2. Para explorar: use list_files, read_file_compact, search_text, retrieve_context.',
      '3. Para editar: use edit_file, create_file, rename_symbol.',
      '4. Apos editar, valide com run_tests e run_linter quando o projeto tiver esses scripts.',
      '5. Em modelos locais pequenos, leia arquivos por ranges e prefira uma mudanca por vez.',
      '6. Finalize o fluxo usando complete_task com um resumo curto em PT-BR.',
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
      tools.retrieveContextTool,
      tools.renameSymbolTool,
      tools.findReferencesTool,
      tools.runTestsTool,
      tools.runLinterTool,
      tools.gitCommitTool,
    ],
    modelSettings: {
      temperature: profile?.temperature ?? 0.1,
      maxTokens: profile?.maxOutputTokens ?? 1536,
      parallelToolCalls: false,
      toolChoice: 'auto',
      truncation: 'auto',
      text: { verbosity: 'low' },
    },
    toolUseBehavior: { stopAtToolNames: ['complete_task'] },
  });

  return { plannerAgent: coderAgent, coderAgent, reviewerAgent: coderAgent };
}
