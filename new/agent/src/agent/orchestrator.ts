import { ReActAgent, ReActConfig } from './react-loop';
import { AgentState, ExecutionPlan } from '../types';
import { ResearchAgent } from './research';
import { PlanningAgent } from './planning';
import { AgentStateMachine } from '../state/machine';

export class OrchestratorAgent {
  private researchAgent: ResearchAgent;
  private planningAgent: PlanningAgent;

  constructor(private config: ReActConfig) {
    this.researchAgent = new ResearchAgent(config);
    this.planningAgent = new PlanningAgent(config);
  }

  async run(task: string, existingState?: AgentState): Promise<{ state: AgentState; plan?: ExecutionPlan }> {
    let state = existingState ?? AgentStateMachine.create(`Orchestrate: ${task}`);
    
    // 1. Phase: Research
    state = AgentStateMachine.addMessage(state, {
      role: 'system',
      content: 'Phase 1: Research started.',
      timestamp: new Date().toISOString()
    });
    
    const { state: postResearchState, brief } = await this.researchAgent.run(task);
    if (!brief) {
      state = AgentStateMachine.fail(postResearchState, 'Failed to produce a ResearchBrief.');
      return { state };
    }

    state = AgentStateMachine.addMessage(postResearchState, {
      role: 'system',
      content: `Phase 1: Research completed.\nBrief: ${JSON.stringify(brief)}`,
      timestamp: new Date().toISOString()
    });

    // 2. Phase: Planning
    state = AgentStateMachine.addMessage(state, {
      role: 'system',
      content: 'Phase 2: Planning started.',
      timestamp: new Date().toISOString()
    });

    const { state: postPlanningState, plan } = await this.planningAgent.run(task, brief);
    if (!plan) {
      state = AgentStateMachine.fail(postPlanningState, 'Failed to produce an ExecutionPlan.');
      return { state };
    }

    state = AgentStateMachine.addMessage(postPlanningState, {
      role: 'system',
      content: `Phase 2: Planning completed.\nPlan:\n${PlanningAgent.formatPlanAsMarkdown(plan)}`,
      timestamp: new Date().toISOString()
    });

    // 3. Phase: Execution (Delegation)
    state = AgentStateMachine.addMessage(state, {
      role: 'system',
      content: 'Phase 3: Execution started.',
      timestamp: new Date().toISOString()
    });

    // Delegate each stream to a worker agent (a basic ReActAgent acting as 'coder')
    for (const stream of plan.streams) {
      if (stream.status !== 'pending') continue;

      state = AgentStateMachine.addMessage(state, {
        role: 'system',
        content: `Delegating Stream: ${stream.id} - ${stream.name}`,
        timestamp: new Date().toISOString()
      });

      const workerAgent = new ReActAgent({
        ...this.config,
        llmConfig: {
          ...this.config.llmConfig,
          systemPrompt: this.config.llmConfig?.systemPrompt + `\n\nYou are a ${stream.owner} agent. Complete the following stream tasks:\n${stream.tasks.join('\n')}\n\nEnsure validations pass:\n${stream.validations.join('\n')}`
        }
      });

      const streamTask = `Stream ${stream.id} context:\nResearch:\n${brief.summary}\n\nYour tasks:\n- ${stream.tasks.join('\n- ')}\n\nValidations:\n- ${stream.validations.join('\n- ')}`;
      const workerState = await workerAgent.run(streamTask);

      if (workerState.status === 'completed') {
        stream.status = 'completed';
        state = AgentStateMachine.addMessage(state, {
          role: 'system',
          content: `Stream ${stream.id} completed successfully.`,
          timestamp: new Date().toISOString()
        });
      } else {
        stream.status = 'failed';
        state = AgentStateMachine.addMessage(state, {
          role: 'system',
          content: `Stream ${stream.id} failed: ${workerState.metadata.errorMessage}`,
          timestamp: new Date().toISOString()
        });
        state = AgentStateMachine.fail(state, `Execution failed on stream ${stream.id}`);
        return { state, plan };
      }
    }

    state = AgentStateMachine.complete(state, 'Orchestration completed successfully.');
    return { state, plan };
  }
}
