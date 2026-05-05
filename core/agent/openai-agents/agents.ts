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
      '1. Para perguntas, diagnosticos e planejamento, use apenas ferramentas de leitura quando precisar de contexto e responda sem editar arquivos.',
      '2. Use create_file, edit_file ou rename_symbol somente quando o usuario pedir explicitamente implementacao, correcao ou alteracao de codigo.',
      '3. Para explorar: use list_files, read_file_compact, search_text, retrieve_context.',
      '4. Apos editar, valide com run_tests e run_linter quando o projeto tiver esses scripts.',
      '5. Nunca chame git_commit sem pedido explicito do usuario.',
      '6. Em modelos locais pequenos, leia arquivos por ranges e prefira uma mudanca por vez.',
      '7. Finalize o fluxo usando complete_task com um resumo curto em PT-BR.',
      '8. NUNCA abra previews, navegadores ou servidores de desenvolvimento automaticamente, a menos que o usuario peca explicitamente.',
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
