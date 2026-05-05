import { EventEmitter } from 'events';
import { runOpenAIAgent, OpenAIAgentConfig } from './agent/openai-agents/orchestrator.js';

export interface AgentRunConfig {
  task: string;
  workspaceRoot: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  maxTurns: number;
}

export interface AgentEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'error' | 'complete';
  content: string;
  metadata?: Record<string, any>;
}

export class AgentRunner extends EventEmitter {
  private isRunning = false;
  private abortController: AbortController | null = null;

  async *run(config: AgentRunConfig): AsyncIterable<AgentEvent> {
    if (this.isRunning) {
      throw new Error('Agent is already running.');
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    const queue: AgentEvent[] = [];
    let resolveNext: (() => void) | null = null;
    let isFinished = false;

    const pushEvent = (event: AgentEvent) => {
      queue.push(event);
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    const orchestratorConfig: OpenAIAgentConfig = {
      workspaceRoot: config.workspaceRoot,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      maxTurns: config.maxTurns,
      onUpdate: (update) => {
        if (update.role === 'system') {
          pushEvent({ type: 'thinking', content: update.content });
        } else if (update.role === 'assistant') {
          pushEvent({ type: 'message', content: update.content });
        } else {
          pushEvent({ type: 'message', content: `[${update.role}] ${update.content}` });
        }
      }
    };

    // Run the agent in the background
    runOpenAIAgent(config.task, orchestratorConfig)
      .then((result) => {
        pushEvent({ type: 'complete', content: 'Task completed.', metadata: { result } });
      })
      .catch((error) => {
        pushEvent({ type: 'error', content: error.message || String(error) });
      })
      .finally(() => {
        this.isRunning = false;
        isFinished = true;
        if (resolveNext) resolveNext();
      });

    // Yield events from the queue
    while (true) {
      if (queue.length > 0) {
        const event = queue.shift()!;
        yield event;
        if (event.type === 'complete' || event.type === 'error') {
          break;
        }
      } else if (isFinished) {
        break;
      } else {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
    }
  }

  stop() {
    if (this.isRunning && this.abortController) {
      this.abortController.abort();
      this.isRunning = false;
    }
  }
}
