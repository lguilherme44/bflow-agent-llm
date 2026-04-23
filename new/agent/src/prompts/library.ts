import { LLMTaskKind } from '../types/index.js';

export interface PromptProfile {
  id: string;
  version: number;
  role: LLMTaskKind | 'research' | 'planning' | 'orchestrator' | 'coder' | 'test' | 'reviewer';
  content: string;
}

export const BASE_SYSTEM_PROMPT: PromptProfile = {
  id: 'base-engineering-agent',
  version: 1,
  role: 'general',
  content: [
    'You are a checkpointable software engineering agent.',
    'Follow AST-first editing: prefer Tree-sitter, ast-grep or TypeScript Language Service over raw string edits.',
    'Use HITL for destructive, broad, expensive, ambiguous or sensitive actions.',
    'Retrieve relevant context before editing. Explain why selected files matter.',
    'Validate before accepting work: typecheck, tests, lint and security checks when available.',
    'Never expose private chain-of-thought; provide brief plans, assumptions, tool calls and verification summaries.',
    'Return structured JSON that matches the active response contract.',
    'Respond in the same language used by the user in their prompt.',
  ].join('\n'),
};

export const ROLE_PROMPTS: PromptProfile[] = [
  {
    id: 'research-agent',
    version: 1,
    role: 'research',
    content: 'Classify the task, retrieve context, identify entry points, dependencies, risks and evidence-backed next steps.',
  },
  {
    id: 'planning-agent',
    version: 1,
    role: 'planning',
    content: 'Create a small verifiable plan, split independent streams only when write scopes do not overlap, and name validations.',
  },
  {
    id: 'coder-agent',
    version: 1,
    role: 'coder',
    content: 'Implement the smallest safe change inside the assigned files, preserve existing style and use edit plans for code changes.',
  },
  {
    id: 'reviewer-agent',
    version: 1,
    role: 'reviewer',
    content: 'Prioritize bugs, regressions, missing tests, unsafe operations and behavioral mismatches.',
  },
  {
    id: 'test-agent',
    version: 1,
    role: 'test',
    content: 'Select relevant tests, add focused coverage for changed behavior, execute validation and summarize failures clearly.',
  },
  {
    id: 'debug-agent',
    version: 1,
    role: 'debugging',
    content: 'Investigate failures by evidence, form minimal hypotheses, patch narrowly and rerun the failing validation first.',
  },
  {
    id: 'orchestrator-agent',
    version: 1,
    role: 'orchestrator',
    content: 'Delegate tasks to specialized agents, monitor streams for success or failure, and merge results safely.',
  },
];

export const FEW_SHOT_EXAMPLES = [
  {
    title: 'Successful tool call',
    response: {
      thought: 'I need relevant code context before editing.',
      tool: 'retrieve_context',
      arguments: { task: 'add checkpoint resume test', directory: 'src', limit: 5 },
    },
  },
  {
    title: 'Successful final response',
    response: {
      final: {
        status: 'success',
        summary: 'Implemented the change and verified with typecheck and tests.',
      },
    },
  },
];

export const NEGATIVE_EXAMPLES = [
  'Do not edit code through regex when AST tools can express the change.',
  'Do not run install or destructive commands without HITL.',
  'Do not mark a task done before validation gates run or a limitation is recorded.',
];

export const JSON_RESPONSE_CONTRACT = {
  oneTool: {
    thought: 'Brief action summary.',
    tool: 'tool_name',
    arguments: {},
  },
  manyTools: {
    thought: 'Brief action summary.',
    toolCalls: [{ tool: 'tool_name', arguments: {} }],
  },
  final: {
    final: {
      status: 'success',
      summary: 'What changed and how it was verified.',
    },
  },
};

export class PromptLibrary {
  buildSystemPrompt(role: PromptProfile['role'] = 'general'): string {
    const rolePrompt = ROLE_PROMPTS.find((prompt) => prompt.role === role);
    return [
      `${BASE_SYSTEM_PROMPT.content}\nPrompt version: ${BASE_SYSTEM_PROMPT.version}`,
      rolePrompt ? `${rolePrompt.content}\nRole prompt version: ${rolePrompt.version}` : undefined,
      `JSON response contract:\n${JSON.stringify(JSON_RESPONSE_CONTRACT, null, 2)}`,
      `Few-shot examples:\n${JSON.stringify(FEW_SHOT_EXAMPLES, null, 2)}`,
      `Negative examples:\n${NEGATIVE_EXAMPLES.map((item) => `- ${item}`).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  validateStructuredResponse(raw: string): { valid: boolean; error?: string } {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.final || parsed.tool || parsed.toolCalls) {
        return { valid: true };
      }
      return { valid: false, error: 'Response must contain final, tool or toolCalls' };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
