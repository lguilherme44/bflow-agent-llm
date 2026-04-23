import { ReActAgent, ReActConfig } from './react-loop.js';
import { AgentState, ExecutionPlan } from '../types/index.js';
import { ResearchAgent } from './research.js';
import { PlanningAgent } from './planning.js';
import { AgentStateMachine } from '../state/machine.js';
import { ToolRegistry } from '../tools/registry.js';
import { RiskPolicyEngine } from '../utils/risk-engine.js';

export type OrchestratorEvent = 
  | { type: 'phase_start'; phase: string }
  | { type: 'phase_complete'; phase: string; details?: string }
  | { type: 'message_added'; role: string; content: string }
  | { type: 'usage_update'; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'error'; message: string }
  | { type: 'human_approval_request'; toolCallId: string; toolName: string; args: any; riskEvaluation?: any };

export type OrchestratorUpdateCallback = (event: OrchestratorEvent) => void;

export class OrchestratorAgent {
  private researchAgent: ResearchAgent;
  private planningAgent: PlanningAgent;
  private totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private onUpdate?: OrchestratorUpdateCallback;
  private liveConfig: ReActConfig;
  private approvalResolver?: (approved: boolean) => void;
  private riskEngine: RiskPolicyEngine;

  constructor(private config: ReActConfig) {
    const languageInstruction = "\n\nIMPORTANT: Always respond in the same language as the user's prompt. If the user speaks Portuguese, you MUST respond in Portuguese.";
    
    this.config.llmConfig = {
      ...this.config.llmConfig,
      systemPrompt: (this.config.llmConfig?.systemPrompt || '') + languageInstruction
    };

    const workspaceRoot = (this.config.registry as any).workspaceRoot || process.cwd();
    this.riskEngine = new RiskPolicyEngine(workspaceRoot);
    this.liveConfig = {
        ...this.config,
        onUpdate: (event) => {
            if (event.type === 'message_added') {
                this.notify({ type: 'message_added', role: event.role!, content: event.content! });
            }
        },
        humanApprovalPolicy: (toolCall) => {
            const evaluation = this.riskEngine.evaluateToolCall(toolCall.toolName, toolCall.arguments);
            if (evaluation.level === 'blocked') {
                return `BLOCKED: ${evaluation.reasons.join(', ')}`;
            }
            if (evaluation.level === 'high' || evaluation.level === 'medium') {
                return evaluation.reasons.join(', ');
            }
            return undefined;
        },
        humanApprovalCallback: async (toolCall) => {
            return new Promise((resolve) => {
                const evaluation = this.riskEngine.evaluateToolCall(toolCall.toolName, toolCall.arguments);
                this.approvalResolver = resolve;
                this.notify({ 
                    type: 'human_approval_request', 
                    toolCallId: toolCall.id,
                    toolName: toolCall.toolName,
                    args: toolCall.arguments,
                    riskEvaluation: evaluation
                });
            });
        }
    };

    this.researchAgent = new ResearchAgent(this.liveConfig);
    this.planningAgent = new PlanningAgent(this.liveConfig);
  }

  public setUpdateCallback(callback: OrchestratorUpdateCallback) {
    this.onUpdate = callback;
    this.notify({ type: 'usage_update', usage: this.totalUsage });
  }

  private notify(event: OrchestratorEvent) {
    this.onUpdate?.(event);
  }

  private updateUsage(state: AgentState) {
    this.totalUsage.totalTokens = state.metadata.totalTokensUsed || 0;
    this.notify({ type: 'usage_update', usage: this.totalUsage });
  }

  async run(task: string, existingState?: AgentState): Promise<{ state: AgentState; plan?: ExecutionPlan }> {
    let state = existingState ?? AgentStateMachine.create(`Orchestrate: ${task}`);
    state = AgentStateMachine.dispatch(state, { type: 'task_started' });

    // --- ETAPA: CLASSIFICAÇÃO DE INTENÇÃO ---
    const intentPrompt = `Analise a tarefa do usuário: "${task}"\nResponda apenas com uma palavra: "CHAT" se for uma saudação, conversa informal ou pergunta genérica. "TASK" se for um comando técnico, solicitação de código, análise de arquivos ou tarefa de engenharia.`;
    const intentResponse = await this.config.llm.complete([{ 
        role: 'system', 
        content: 'Você é um classificador de intenções. Responda apenas "CHAT" ou "TASK".',
        timestamp: new Date().toISOString()
    }, { 
        role: 'user', 
        content: intentPrompt,
        timestamp: new Date().toISOString()
    }], { ...this.config.llmConfig, temperature: 0 });

    const intent = intentResponse.content.trim().toUpperCase();

    if (intent.includes('CHAT')) {
        this.notify({ type: 'phase_start', phase: 'Chat' });
        
        // ECONOMIA DE TOKENS: Para Chat, não precisamos de todas as ferramentas de dev
        const chatRegistry = new ToolRegistry();
        // O ReActAgent precisa do complete_task para finalizar
        chatRegistry.register(this.config.registry.get('complete_task')!);

        const chatAgent = new ReActAgent({
            ...this.liveConfig,
            registry: chatRegistry, // Registry enxuto = prompt minúsculo
            llmConfig: {
                ...this.config.llmConfig,
                systemPrompt: "Você é um assistente amigável. Responda à saudação do usuário em Português (PT-BR) de forma natural e depois use complete_task para encerrar a interação."
            }
        });

        const chatState = await chatAgent.run(task);
        this.totalUsage.totalTokens = chatState.metadata.totalTokensUsed || 0;
        this.notify({ type: 'usage_update', usage: this.totalUsage });
        
        // Extrair e exibir a resposta final no quadro verde
        const lastMsg = chatState.messages.filter(m => m.role === 'assistant').at(-1)?.content || '';
        let summary = 'Olá! Como posso ajudar hoje?';
        
        try {
            const clean = lastMsg.replace(/```json|```/g, '').trim();
            if (clean.startsWith('{')) {
                const parsed = JSON.parse(clean);
                // Busca em várias profundidades para garantir que nada escape
                summary = parsed.arguments?.summary || parsed.summary || parsed.final?.summary || parsed.thought || lastMsg;
            }
        } catch {
            summary = lastMsg;
        }

        this.notify({ type: 'message_added', role: 'assistant', content: `RESUMO FINAL: ${summary}` });
        this.notify({ type: 'phase_complete', phase: 'Finalized' });
        return { state: chatState };
    }

    // --- FLUXO NORMAL DE TAREFA ---
    this.notify({ type: 'phase_start', phase: 'Research' });
    this.notify({ type: 'message_added', role: 'system', content: 'Iniciando fase de pesquisa...' });
    
    const researchResult = await this.researchAgent.run(task);
    const postResearchState = researchResult.state;
    const brief = researchResult.brief;

    this.updateUsage(postResearchState);

    if (!brief) {
      const error = postResearchState.status === 'error' ? postResearchState.metadata.errorMessage : 'Falha ao gerar ResearchBrief.';
      state = AgentStateMachine.fail(postResearchState, error || 'Erro desconhecido na pesquisa');
      this.notify({ type: 'error', message: error || 'Erro desconhecido na pesquisa' });
      return { state };
    }

    this.notify({ type: 'message_added', role: 'system', content: 'Pesquisa concluída com sucesso.' });
    this.notify({ type: 'phase_complete', phase: 'Research' });

    this.notify({ type: 'phase_start', phase: 'Planning' });
    this.notify({ type: 'message_added', role: 'system', content: 'Iniciando planejamento da tarefa...' });

    const planningResult = await this.planningAgent.run(task, brief);
    const postPlanningState = planningResult.state;
    const plan = planningResult.plan;

    this.totalUsage.totalTokens += postPlanningState.metadata.totalTokensUsed || 0;
    this.notify({ type: 'usage_update', usage: this.totalUsage });

    if (!plan) {
      const error = postPlanningState.status === 'error' ? postPlanningState.metadata.errorMessage : 'Falha ao gerar ExecutionPlan.';
      state = AgentStateMachine.fail(postPlanningState, error || 'Erro desconhecido no planejamento');
      this.notify({ type: 'error', message: error || 'Erro desconhecido no planejamento' });
      return { state };
    }

    this.notify({ type: 'message_added', role: 'system', content: 'Plano de execução gerado.' });
    this.notify({ type: 'phase_complete', phase: 'Planning' });

    this.notify({ type: 'phase_start', phase: 'Execution' });

    for (const stream of plan.streams) {
      if (stream.status !== 'pending') continue;
      this.notify({ type: 'message_added', role: 'system', content: `Executando: ${stream.name}` });

      const workerAgent = new ReActAgent({
        ...this.liveConfig,
        llmConfig: {
          ...this.config.llmConfig,
          systemPrompt: (this.config.llmConfig?.systemPrompt || '') + 
            `\n\n### CONTEXTO DE PESQUISA\n${JSON.stringify(brief, null, 2)}\n` +
            `### PLANO DE EXECUÇÃO\n${plan.summary}\n` +
            `\n\nVocê é um agente ${stream.owner}. Sua missão é executar as tarefas acima.` +
            `\n\nREGRAS CRÍTICAS DE IDIOMA E SAÍDA:` +
            `\n1. VOCÊ DEVE FALAR EXCLUSIVAMENTE EM PORTUGUÊS (PT-BR).` +
            `\n2. TODOS OS SEUS PENSAMENTOS ('thought') E RESUMOS ('summary') DEVEM SER EM PORTUGUÊS.` +
            `\n3. NÃO USE INGLÊS, MESMO QUE AS FERRAMENTAS DEVEM RETORNAR TEXTO EM INGLÊS.` +
            `\n4. PARA FINALIZAR, USE A FERRAMENTA 'complete_task' E ESCREVA O RESUMO EM PORTUGUÊS.` +
            `\n5. USE SEMPRE OS CAMINHOS EXATOS RETORNADOS PELAS FERRAMENTAS (como git_status ou list_files). NÃO ADICIONE NEM REMOVA PREFIXOS DE DIRETÓRIO.`
        }
      });

      const workerState = await workerAgent.run(`Stream ${stream.id} tasks:\n- ${stream.tasks.join('\n- ')}`);
      this.totalUsage.totalTokens += workerState.metadata.totalTokensUsed || 0;
      this.notify({ type: 'usage_update', usage: this.totalUsage });

      if (workerState.status === 'completed') {
        stream.status = 'completed';
        const completeTaskResult = workerState.toolHistory.find(t => t.call.toolName === 'complete_task')?.result;
        let summary = (completeTaskResult as any)?.summary;

        if (!summary) {
          const lastAssistantMsg = workerState.messages.filter(m => m.role === 'assistant').at(-1)?.content || '';
          try {
            const cleanJson = lastAssistantMsg.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(cleanJson);
            summary = parsed.arguments?.summary || parsed.summary || parsed.final?.summary || parsed.thought;
          } catch {
            summary = lastAssistantMsg.length > 20 ? lastAssistantMsg : null;
          }
        }
        this.notify({ type: 'message_added', role: 'assistant', content: `RESUMO FINAL: ${summary || 'Finalizado.'}` });
      } else {
        stream.status = 'failed';
        this.notify({ type: 'error', message: `Falha na execução: ${workerState.metadata.errorMessage}` });
        state = AgentStateMachine.fail(state, `Erro no stream ${stream.id}`);
        return { state, plan };
      }
    }

    state = AgentStateMachine.complete(state, 'Orquestração finalizada com sucesso.');
    this.notify({ type: 'message_added', role: 'system', content: '=== TAREFA FINALIZADA ===' });
    this.notify({ type: 'phase_complete', phase: 'Finalized' });
    return { state, plan };
  }

  public resolveApproval(approved: boolean) {
    if (this.approvalResolver) {
        this.approvalResolver(approved);
        this.approvalResolver = undefined;
    }
  }
}
