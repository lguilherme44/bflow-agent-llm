import { ReActAgent, ReActConfig } from './react-loop.js';
import { AgentState, ExecutionPlan } from '../types/index.js';
import { ResearchAgent } from './research.js';
import { PlanningAgent } from './planning.js';
import { AgentStateMachine } from '../state/machine.js';

export type OrchestratorEvent = 
  | { type: 'phase_start'; phase: string }
  | { type: 'phase_complete'; phase: string; details?: string }
  | { type: 'message_added'; role: string; content: string }
  | { type: 'usage_update'; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'error'; message: string };

export type OrchestratorUpdateCallback = (event: OrchestratorEvent) => void;

export class OrchestratorAgent {
  private researchAgent: ResearchAgent;
  private planningAgent: PlanningAgent;
  private totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private onUpdate?: OrchestratorUpdateCallback;

  constructor(private config: ReActConfig) {
    const languageInstruction = "\n\nIMPORTANT: Always respond in the same language as the user's prompt. If the user speaks Portuguese, you MUST respond in Portuguese.";
    
    this.config.llmConfig = {
      ...this.config.llmConfig,
      systemPrompt: (this.config.llmConfig?.systemPrompt || '') + languageInstruction
    };

    // Criamos uma configuração "viva" que repassa eventos para o Orchestrator
    const liveConfig: ReActConfig = {
        ...this.config,
        onUpdate: (event) => {
            if (event.usage) {
                // Não acumulamos aqui para evitar duplicidade, o ReActAgent já acumula no estado
            }
            if (event.type === 'message_added') {
                this.notify({ type: 'message_added', role: event.role!, content: event.content! });
            }
        }
    };

    this.researchAgent = new ResearchAgent(liveConfig);
    this.planningAgent = new PlanningAgent(liveConfig);
  }

  public setUpdateCallback(callback: OrchestratorUpdateCallback) {
    this.onUpdate = callback;
    this.notify({ type: 'usage_update', usage: this.totalUsage });
  }

  private notify(event: OrchestratorEvent) {
    this.onUpdate?.(event);
  }

  private updateUsage(state: AgentState) {
    // O ReActAgent já acumula os tokens no metadado do estado.
    // Pegamos o valor absoluto do estado final de cada fase.
    this.totalUsage.totalTokens = state.metadata.totalTokensUsed || 0;
    this.notify({ type: 'usage_update', usage: this.totalUsage });
  }

  async run(task: string, existingState?: AgentState): Promise<{ state: AgentState; plan?: ExecutionPlan }> {
    let state = existingState ?? AgentStateMachine.create(`Orchestrate: ${task}`);
    
    // 1. Phase: Research
    this.notify({ type: 'phase_start', phase: 'Research' });
    this.notify({ type: 'message_added', role: 'system', content: 'Iniciando fase de pesquisa...' });
    
    const researchResult = await this.researchAgent.run(task);
    const postResearchState = researchResult.state;
    const brief = researchResult.brief;

    this.updateUsage(postResearchState);

    if (!brief) {
      const error = postResearchState.status === 'error' 
        ? postResearchState.metadata.errorMessage 
        : 'Falha ao gerar ResearchBrief.';
      state = AgentStateMachine.fail(postResearchState, error || 'Erro desconhecido na pesquisa');
      this.notify({ type: 'error', message: error || 'Erro desconhecido na pesquisa' });
      return { state };
    }

    this.notify({ type: 'message_added', role: 'system', content: 'Pesquisa concluída com sucesso.' });
    this.notify({ type: 'phase_complete', phase: 'Research' });

    // 2. Phase: Planning
    this.notify({ type: 'phase_start', phase: 'Planning' });
    this.notify({ type: 'message_added', role: 'system', content: 'Iniciando planejamento da tarefa...' });

    const planningResult = await this.planningAgent.run(task, brief);
    const postPlanningState = planningResult.state;
    const plan = planningResult.plan;

    // Acumulamos o uso do planejamento (que já inclui a pesquisa se o estado for o mesmo, 
    // mas aqui o PlanningAgent cria seu próprio ReActAgent).
    // Para simplificar o contador, vamos somar os totais de cada fase independente.
    this.totalUsage.totalTokens += postPlanningState.metadata.totalTokensUsed || 0;
    this.notify({ type: 'usage_update', usage: this.totalUsage });

    if (!plan) {
      const error = postPlanningState.status === 'error'
        ? postPlanningState.metadata.errorMessage
        : 'Falha ao gerar ExecutionPlan.';
      state = AgentStateMachine.fail(postPlanningState, error || 'Erro desconhecido no planejamento');
      this.notify({ type: 'error', message: error || 'Erro desconhecido no planejamento' });
      return { state };
    }

    this.notify({ type: 'message_added', role: 'system', content: 'Plano de execução gerado.' });
    this.notify({ type: 'phase_complete', phase: 'Planning' });

    // 3. Phase: Execution
    this.notify({ type: 'phase_start', phase: 'Execution' });

    for (const stream of plan.streams) {
      if (stream.status !== 'pending') continue;

      this.notify({ type: 'message_added', role: 'system', content: `Executando: ${stream.name}` });

      const workerAgent = new ReActAgent({
        ...this.config,
        onUpdate: (e) => {
            if (e.type === 'message_added') {
                this.notify({ type: 'message_added', role: e.role!, content: e.content! });
            }
        },
        llmConfig: {
          ...this.config.llmConfig,
          systemPrompt: (this.config.llmConfig?.systemPrompt || '') + 
            `\n\n### RESEARCH CONTEXT\n${JSON.stringify(brief, null, 2)}\n` +
            `### EXECUTION PLAN\n${plan.summary}\n` +
            `\n\nYou are a ${stream.owner} agent. Complete the task streams. ` +
            `IMPORTANT: Always respond in Portuguese. To provide your final answer, you MUST use the 'complete_task' tool. ` +
            `Do NOT use a tool named 'final'. Use only 'complete_task'.`
        }
      });

      const streamTask = `Stream ${stream.id} tasks:\n- ${stream.tasks.join('\n- ')}`;
      const workerState = await workerAgent.run(streamTask);
      
      this.totalUsage.totalTokens += workerState.metadata.totalTokensUsed || 0;
      this.notify({ type: 'usage_update', usage: this.totalUsage });

      if (workerState.status === 'completed') {
        stream.status = 'completed';
        // Buscamos o resumo da ferramenta complete_task para exibir na UI
        const completeTaskResult = workerState.toolHistory.find(t => t.call.toolName === 'complete_task')?.result;
        const summary = (completeTaskResult as any)?.summary || 'Stream concluído com sucesso.';
        
        this.notify({ type: 'message_added', role: 'assistant', content: `RESUMO FINAL: ${summary}` });
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
}
