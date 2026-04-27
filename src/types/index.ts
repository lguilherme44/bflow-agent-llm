export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'acting'
  | 'observing'
  | 'awaiting_human'
  | 'error'
  | 'completed';

export type AgentEventType =
  | 'task_started'
  | 'observation_started'
  | 'thought_started'
  | 'tool_call_started'
  | 'tool_call_finished'
  | 'human_approval_requested'
  | 'human_approval_resolved'
  | 'verification_started'
  | 'task_completed'
  | 'task_failed'
  | 'resume_requested'
  | 'reset_requested';

export interface AgentEvent {
  type: AgentEventType;
  reason?: string;
  timestamp: string;
  toolCallId?: string;
  from?: AgentStatus;
  to?: AgentStatus;
  approved?: boolean;
}

export interface ToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, JsonValue>;
  timestamp: string;
}

export type ToolErrorCode =
  | 'TOOL_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'TIMEOUT'
  | 'TRANSIENT_ERROR'
  | 'CRITICAL_ERROR'
  | 'HUMAN_REJECTED'
  | 'EXECUTION_ERROR'
  | 'ROLLBACK_FAILED';

export interface RollbackResult {
  attempted: boolean;
  success: boolean;
  error?: string;
  timestamp: string;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  data: JsonValue;
  error?: string;
  durationMs: number;
  timestamp: string;
  attempts: number;
  timedOut: boolean;
  recoverable: boolean;
  errorCode?: ToolErrorCode;
  nextActionHint?: string;
  rollback?: RollbackResult;
}

export interface ToolExample {
  description: string;
  arguments: Record<string, JsonValue>;
  expectedOutput?: JsonValue;
}

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  enum?: JsonValue[];
  items?: JSONSchema;
  additionalProperties?: boolean | JSONSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface RecoverableToolError {
  code: string;
  message: string;
  correctionHint: string;
}

export interface ToolSchema {
  name: string;
  summary: string;
  description: string;
  whenToUse: string;
  whenNotToUse?: string;
  expectedOutput: string;
  failureModes: string[];
  recoverableErrors: RecoverableToolError[];
  parameters: JSONSchema;
  examples: ToolExample[];
  dangerous?: boolean;
  tags?: string[];
  category?: string;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResult?: ToolResult;
  timestamp: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
  };
}

export interface HumanApprovalRequest {
  id: string;
  toolCall: ToolCall;
  reason: string;
  policyName?: string;
  requestedAt: string;
  resolved: boolean;
  approved?: boolean;
  resolvedAt?: string;
  resolutionMessage?: string;
}

export interface RelevantFileContext {
  filepath: string;
  readCount: number;
  touchCount: number;
  lastReadAt?: string;
  lastTouchedAt?: string;
  score: number;
  reason?: string;
}

export type ContextItemKind =
  | 'message'
  | 'file'
  | 'tool_result'
  | 'memory'
  | 'decision'
  | 'constraint'
  | 'approval';

export interface ContextItem {
  id: string;
  kind: ContextItemKind;
  content: string;
  createdAt: string;
  updatedAt: string;
  tokensEstimate: number;
  priority: number;
  metadata: Record<string, JsonValue>;
}

export interface StructuredSummary {
  currentTask: string | null;
  progress: string[];
  decisions: string[];
  constraints: string[];
  relevantFiles: string[];
  errorsAndAttempts: string[];
  humanApprovals: string[];
  nextActions: string[];
}

export interface AgentContextState {
  items: ContextItem[];
  decisions: string[];
  constraints: string[];
  relevantFiles: Record<string, RelevantFileContext>;
  summary?: StructuredSummary;
}

export interface AgentMetadata {
  createdAt: string;
  updatedAt: string;
  iterationCount: number;
  maxIterations: number;
  totalTokensUsed: number;
  checkpointVersion: number;
  schemaVersion: number;
  traceId?: string;
  lastResumeReason?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface AgentState {
  id: string;
  status: AgentStatus;
  messages: AgentMessage[];
  currentTask: string | null;
  toolHistory: Array<{ call: ToolCall; result: ToolResult }>;
  eventHistory: AgentEvent[];
  context: AgentContextState;
  metadata: AgentMetadata;
  pendingHumanApproval?: HumanApprovalRequest;
}

export interface LLMFinalResponse {
  status: 'success' | 'failure' | 'needs_human';
  summary: string;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  finalResponse?: LLMFinalResponse;
  parseError?: string;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'error' | 'other';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
  };
  model?: string;
  latencyMs?: number;
}

export interface LLMConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  contextWindow?: number;
}

export type LLMTaskKind =
  | 'planning'
  | 'code'
  | 'review'
  | 'summary'
  | 'debugging'
  | 'general';

export interface LLMUsageCost {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface LLMProviderRequest {
  messages: AgentMessage[];
  config?: Partial<LLMConfig>;
  taskKind: LLMTaskKind;
  tools?: ToolSchema[];
  signal?: AbortSignal;
  onStream?: (chunk: string) => void;
}

export interface LLMProviderResponse extends LLMResponse {
  provider: string;
  model: string;
  latencyMs: number;
  estimatedCostUsd: number;
}

export interface LLMProviderCapabilities {
  streaming: boolean;
  nativeToolCalling: boolean;
  jsonMode: boolean;
}

export interface LLMProvider {
  name: string;
  defaultModel: string;
  capabilities: LLMProviderCapabilities;
  complete(request: LLMProviderRequest): Promise<LLMProviderResponse>;
  stream?(request: LLMProviderRequest): AsyncIterable<string>;
}

export interface LLMRouterPolicy {
  primaryProvider: string;
  fallbackProviders: string[];
  taskModelPreferences: Partial<Record<LLMTaskKind, string>>;
  maxEstimatedCostUsd?: number;
  timeoutMs: number;
  /** Maximum concurrent LLM calls (rate limit for parallel sub-agents). Default: 3 */
  maxConcurrentCalls?: number;
}

// ── Tool Budget ───────────────────────────────────────────────

export interface ToolBudget {
  /** Maximum number of tool calls allowed. Default: 50 */
  maxToolCalls: number;
  /** Maximum total tokens (prompt + completion) allowed. Default: 100k */
  maxTokens: number;
  /** Maximum estimated cost in USD. Default: 0.50 */
  maxCostUsd: number;
}

export const DEFAULT_TOOL_BUDGETS: Record<string, ToolBudget> = {
  researcher: { maxToolCalls: 20, maxTokens: 50_000, maxCostUsd: 0.25 },
  planner:    { maxToolCalls: 15, maxTokens: 30_000, maxCostUsd: 0.15 },
  coder:      { maxToolCalls: 50, maxTokens: 100_000, maxCostUsd: 0.50 },
  reviewer:   { maxToolCalls: 20, maxTokens: 40_000, maxCostUsd: 0.20 },
  tester:     { maxToolCalls: 30, maxTokens: 60_000, maxCostUsd: 0.30 },
  debug:      { maxToolCalls: 25, maxTokens: 50_000, maxCostUsd: 0.25 },
  docs:       { maxToolCalls: 15, maxTokens: 25_000, maxCostUsd: 0.10 },
  orchestrator: { maxToolCalls: 10, maxTokens: 20_000, maxCostUsd: 0.10 },
  default:    { maxToolCalls: 50, maxTokens: 100_000, maxCostUsd: 0.50 },
};

export type ToolFunction = (
  args: Record<string, JsonValue>,
  context: ToolExecutionContext
) => Promise<unknown>;

export interface ToolExecutionContext {
  state: AgentState;
  signal: AbortSignal;
}

export interface ToolRetryPolicy {
  maxRetries?: number;
  retryTimeouts?: boolean;
  retryTransientErrors?: boolean;
}

export interface ToolDefinition {
  schema: ToolSchema;
  execute: ToolFunction;
  rollback?: (
    args: Record<string, JsonValue>,
    previousResult: JsonValue,
    context: ToolExecutionContext
  ) => Promise<void>;
  timeoutMs?: number;
  retryPolicy?: ToolRetryPolicy;
  critical?: boolean;
}

export type CodeLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'json'
  | 'unknown';

export interface SourcePosition {
  line: number;
  column: number;
  index: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export interface AstNode {
  id: string;
  kind: string;
  name?: string;
  range: SourceRange;
  text?: string;
  children?: AstNode[];
}

export interface SymbolReference {
  name: string;
  kind:
    | 'function'
    | 'arrow_function'
    | 'class'
    | 'method'
    | 'interface'
    | 'type'
    | 'import'
    | 'export'
    | 'jsx_element'
    | 'hook'
    | 'call'
    | 'json_property';
  filepath: string;
  range: SourceRange;
  exported?: boolean;
  importedFrom?: string;
}

export interface CodeDiagnostic {
  filepath: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  range?: SourceRange;
  code?: string | number;
}

export interface CodeDocument {
  filepath: string;
  language: CodeLanguage;
  content: string;
  contentHash: string;
  parsedAt: string;
  ast: AstNode;
  symbols: SymbolReference[];
  imports: SymbolReference[];
  exports: SymbolReference[];
  diagnostics: CodeDiagnostic[];
}

export interface TextPatch {
  filepath: string;
  range: SourceRange;
  oldText: string;
  newText: string;
}

export interface EditPlanFallback {
  reason: string;
  requiresHumanApproval: boolean;
  validationStrength: 'normal' | 'reinforced';
}

export interface EditPlan {
  id: string;
  description: string;
  filesRead: string[];
  filesModified: string[];
  patches: TextPatch[];
  semanticSummary: string;
  diff: string;
  validations: string[];
  createdAt: string;
  status: 'planned' | 'applied' | 'reverted';
  fallback?: EditPlanFallback;
  requiresHumanApproval: boolean;
}

export interface CodeToolResult {
  filesRead: string[];
  filesModified: string[];
  semanticSummary: string;
  diff: string;
  validations: string[];
}

export interface RetrievalChunkMetadata {
  filepath: string;
  language: CodeLanguage | 'markdown';
  symbols: string[];
  imports: string[];
  exports: string[];
  modifiedAt: string;
  owner?: string;
  module?: string;
  chunkKind: 'symbol' | 'markdown' | 'adr' | 'test' | 'route' | 'file';
}

export interface RetrievalChunk {
  id: string;
  content: string;
  contentHash: string;
  metadata: RetrievalChunkMetadata;
  tokensEstimate: number;
  indexedAt: string;
}

export interface RetrievalResult {
  chunk: RetrievalChunk;
  score: number;
  reasons: string[];
}

export type AgentRole = 'researcher' | 'planner' | 'orchestrator' | 'coder' | 'reviewer';

export interface ResearchBrief {
  taskType: 'bugfix' | 'feature' | 'refactor' | 'test' | 'investigation' | 'documentation';
  entryPoints: string[];
  dependencies: string[];
  risks: string[];
  summary: string;
}

export interface ExecutionStream {
  id: string;
  name: string;
  owner: AgentRole;
  tasks: string[];
  validations: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  blockedBy?: string[];
}

export interface ExecutionPlan {
  summary: string;
  streams: ExecutionStream[];
  estimatedRisk: 'low' | 'medium' | 'high';
}

// ── Feedback Loop Types (Phase 6.3) ──────────────────────────

export type StreamFailureKind =
  | 'test_failure'
  | 'build_failure'
  | 'lint_failure'
  | 'review_rejection'
  | 'insufficient_quality'
  | 'unknown';

export interface FeedbackIteration {
  iteration: number;
  failureKind: StreamFailureKind;
  delegatedTo: AgentRole;
  streamId: string;
  recoveryStreamId: string;
  error: string;
  resolvedAt?: string;
  resolved: boolean;
  tokensBefore: number;
  tokensAfter?: number;
}

export interface FeedbackLoopPolicy {
  maxRetries: number;
  maxCostTokens: number;
  enableAutoLintFix: boolean;
}

export interface FailurePattern {
  kind: StreamFailureKind;
  errorSignature: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  resolved: number;
  total: number;
}

// ── Persona & Output Styles ───────────────────────────────────

export type PersonaStyle = 'concise' | 'standard' | 'explainer' | 'tutor';

// ── Hook System Types ─────────────────────────────────────────

export type HookType = 'pre_tool' | 'post_tool';
export type HookAction = 'block' | 'warn';

export interface HookRule {
  id: string;
  name: string;
  description: string;
  type: HookType;
  action: HookAction;
  pattern: string; // Regex pattern
  message: string;
  toolFilter?: string[]; // Optional list of tools to apply this rule to
}

export interface HookEvaluation {
  ruleId: string;
  action: HookAction;
  message: string;
  triggered: boolean;
}
