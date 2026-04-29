import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LogEntry } from './logger.js';

export interface ProviderBreakdown {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  calls: number;
}

export interface SessionMetadata {
  id: string;
  startTime: string;
  lastUpdateTime: string;
  task: string;
  status: 'completed' | 'error' | 'in_progress';
  tokenUsage: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  avgLatencyMs: number;
  providerBreakdown: ProviderBreakdown[];
  toolCallCount: number;
  toolErrorCount: number;
  success: boolean;
}

export interface DashboardStats {
  totalSessions: number;
  successRate: number;
  errorRate: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalEstimatedCostUsd: number;
  avgLatencyMs: number;
  avgTokensPerSession: number;
}

export interface SessionBreakdown {
  sessionId: string;
  task: string;
  status: string;
  tokenUsage: { prompt: number; completion: number; total: number };
  estimatedCostUsd: number;
  avgLatencyMs: number;
  providers: ProviderBreakdown[];
  toolCalls: {
    total: number;
    success: number;
    error: number;
    byTool: Record<string, { total: number; success: number; error: number; avgDurationMs: number }>;
  };
  timeline: Array<{
    timestamp: string;
    type: string;
    tokensUsed?: number;
    toolName?: string;
    success?: boolean;
    durationMs?: number;
  }>;
}

// ── Cost Estimation ──────────────────────────────────────────

const PROVIDER_PRICING: Record<string, { promptPer1M: number; completionPer1M: number }> = {
  ollama: { promptPer1M: 0, completionPer1M: 0 },
  lmstudio: { promptPer1M: 0, completionPer1M: 0 },
  openai: { promptPer1M: 2.50, completionPer1M: 10.00 },
  anthropic: { promptPer1M: 3.00, completionPer1M: 15.00 },
  openrouter: { promptPer1M: 1.50, completionPer1M: 6.00 },
};

function estimateCostUsd(provider: string, promptTokens: number, completionTokens: number): number {
  const pricing = PROVIDER_PRICING[provider.toLowerCase()] ?? { promptPer1M: 2.50, completionPer1M: 10.00 };
  return (promptTokens / 1_000_000) * pricing.promptPer1M + (completionTokens / 1_000_000) * pricing.completionPer1M;
}

// ── Dashboard Service ─────────────────────────────────────────

export class DashboardService {
  private readonly logDirectory: string;

  constructor(logDirectory?: string) {
    this.logDirectory = logDirectory ?? path.join(process.cwd(), '.agent', 'logs');
  }

  async listSessions(): Promise<SessionMetadata[]> {
    try {
      const files = await fs.readdir(this.logDirectory);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
      
      const sessions = await Promise.all(jsonlFiles.map(async (file) => {
        const id = file.replace('.jsonl', '');
        return this.getSessionMetadata(id);
      }));

      return sessions.sort((a, b) => new Date(b.lastUpdateTime).getTime() - new Date(a.lastUpdateTime).getTime());
    } catch (error) {
      console.error('[DashboardService] Error listing sessions:', error);
      return [];
    }
  }

  async getSessionLogs(agentId: string): Promise<LogEntry[]> {
    try {
      const filePath = path.join(this.logDirectory, `${agentId}.jsonl`);
      const content = await fs.readFile(filePath, 'utf-8');
      return content.split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch (error) {
      console.error(`[DashboardService] Error reading logs for ${agentId}:`, error);
      return [];
    }
  }

  async getSessionBreakdown(agentId: string): Promise<SessionBreakdown | null> {
    const logs = await this.getSessionLogs(agentId);
    if (logs.length === 0) return null;

    const llmLogs = logs.filter(l => l.type === 'llm');
    const toolLogs = logs.filter(l => l.type === 'tool');
    const eventLogs = logs.filter(l => l.type === 'event');

    // Token breakdown
    const promptTokens = llmLogs.reduce((acc, l) => acc + ((l.payload.usage as any)?.promptTokens || 0), 0);
    const completionTokens = llmLogs.reduce((acc, l) => acc + ((l.payload.usage as any)?.completionTokens || 0), 0);
    const totalTokens = promptTokens + completionTokens;

    // Provider breakdown
    const providerMap = new Map<string, ProviderBreakdown>();
    for (const l of llmLogs) {
      const provider = (l.payload.provider as string) || 'unknown';
      const model = (l.payload.model as string) || 'unknown';
      const key = `${provider}:${model}`;
      const existing = providerMap.get(key);
      const prompt = (l.payload.usage as any)?.promptTokens || 0;
      const completion = (l.payload.usage as any)?.completionTokens || 0;

      if (existing) {
        existing.promptTokens += prompt;
        existing.completionTokens += completion;
        existing.totalTokens += prompt + completion;
        existing.calls += 1;
        existing.estimatedCostUsd = estimateCostUsd(provider, existing.promptTokens, existing.completionTokens);
      } else {
        providerMap.set(key, {
          provider,
          model,
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: prompt + completion,
          estimatedCostUsd: estimateCostUsd(provider, prompt, completion),
          calls: 1,
        });
      }
    }

    // Latency
    const latencies = llmLogs
      .map(l => l.payload.latencyMs as number)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    const avgLatencyMs = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    // Cost
    const totalCostUsd = Array.from(providerMap.values()).reduce((acc, p) => acc + p.estimatedCostUsd, 0);

    // Tool calls
    const toolByTool = new Map<string, { total: number; success: number; error: number; durations: number[] }>();
    for (const t of toolLogs) {
      const name = (t.payload.toolName as string) || 'unknown';
      const existing = toolByTool.get(name) || { total: 0, success: 0, error: 0, durations: [] };
      existing.total += 1;
      if (t.payload.success) {
        existing.success += 1;
      } else {
        existing.error += 1;
      }
      const duration = t.payload.durationMs as number;
      if (typeof duration === 'number') existing.durations.push(duration);
      toolByTool.set(name, existing);
    }

    const toolCallsSummary = {
      total: toolLogs.length,
      success: toolLogs.filter(l => l.payload.success).length,
      error: toolLogs.filter(l => !l.payload.success).length,
      byTool: {} as Record<string, { total: number; success: number; error: number; avgDurationMs: number }>,
    };
    for (const [name, data] of toolByTool) {
      toolCallsSummary.byTool[name] = {
        total: data.total,
        success: data.success,
        error: data.error,
        avgDurationMs: data.durations.length > 0
          ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
          : 0,
      };
    }

    // Timeline (simplified)
    const timeline = logs.slice(0, 200).map(l => ({
      timestamp: l.timestamp,
      type: l.type,
      tokensUsed: l.type === 'llm' ? ((l.payload.usage as any)?.totalTokens || 0) as number : undefined,
      toolName: l.type === 'tool' ? (l.payload.toolName as string) : undefined,
      success: l.type === 'tool' ? (l.payload.success as boolean) : undefined,
      durationMs: (l.payload.durationMs as number) || (l.type === 'llm' ? (l.payload.latencyMs as number) : undefined),
    }));

    const startEvent = eventLogs.find(l => l.payload.event === 'orchestrator_started');

    return {
      sessionId: agentId,
      task: (startEvent?.payload.task as string) || 'Unknown',
      status: 'completed', // Will be refined by caller
      tokenUsage: { prompt: promptTokens, completion: completionTokens, total: totalTokens },
      estimatedCostUsd: totalCostUsd,
      avgLatencyMs,
      providers: Array.from(providerMap.values()),
      toolCalls: toolCallsSummary,
      timeline,
    };
  }

  async getStats(): Promise<DashboardStats> {
    const sessions = await this.listSessions();
    if (sessions.length === 0) {
      return {
        totalSessions: 0,
        successRate: 0,
        errorRate: 0,
        totalTokens: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalEstimatedCostUsd: 0,
        avgLatencyMs: 0,
        avgTokensPerSession: 0,
      };
    }

    const completed = sessions.filter(s => s.status === 'completed').length;
    const errors = sessions.filter(s => s.status === 'error').length;
    const totalTokens = sessions.reduce((acc, s) => acc + s.tokenUsage, 0);
    const totalPromptTokens = sessions.reduce((acc, s) => acc + s.promptTokens, 0);
    const totalCompletionTokens = sessions.reduce((acc, s) => acc + s.completionTokens, 0);
    const totalCost = sessions.reduce((acc, s) => acc + s.estimatedCostUsd, 0);
    const latencies = sessions.map(s => s.avgLatencyMs).filter(v => v > 0);
    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

    return {
      totalSessions: sessions.length,
      successRate: (completed / sessions.length) * 100,
      errorRate: (errors / sessions.length) * 100,
      totalTokens,
      totalPromptTokens,
      totalCompletionTokens,
      totalEstimatedCostUsd: totalCost,
      avgLatencyMs: Math.round(avgLatency),
      avgTokensPerSession: Math.round(totalTokens / sessions.length),
    };
  }

  private async getSessionMetadata(agentId: string): Promise<SessionMetadata> {
    const logs = await this.getSessionLogs(agentId);
    if (logs.length === 0) {
        return {
            id: agentId,
            startTime: new Date().toISOString(),
            lastUpdateTime: new Date().toISOString(),
            task: 'Unknown',
            status: 'in_progress',
            tokenUsage: 0,
            promptTokens: 0,
            completionTokens: 0,
            estimatedCostUsd: 0,
            avgLatencyMs: 0,
            providerBreakdown: [],
            toolCallCount: 0,
            toolErrorCount: 0,
            success: false,
        };
    }

    const startEvent = logs.find(l => l.type === 'event' && l.payload.event === 'orchestrator_started');
    const endEvent = logs.find(l => 
        l.type === 'event' && 
        ['orchestrator_completed', 'error', 'task_completed', 'task_failed', 'phase_completed'].includes(l.payload.event as string)
    );
    
    const lastUpdate = new Date(logs[logs.length - 1].timestamp).getTime();
    const isOld = (Date.now() - lastUpdate) > 1000 * 60 * 30; // 30 minutes

    let status: 'completed' | 'error' | 'in_progress' = 'in_progress';
    if (endEvent) {
        const event = endEvent.payload.event as string;
        if (event === 'orchestrator_completed' || event === 'task_completed' || event === 'phase_completed') {
            status = 'completed';
        } else if (event === 'error' || event === 'task_failed') {
            status = 'error';
        }
    } else if (isOld) {
        status = 'completed';
    }

    // LLM tokens
    const llmLogs = logs.filter(l => l.type === 'llm');
    const promptTokens = llmLogs.reduce((acc, l) => acc + ((l.payload.usage as any)?.promptTokens || 0), 0);
    const completionTokens = llmLogs.reduce((acc, l) => acc + ((l.payload.usage as any)?.completionTokens || 0), 0);
    const tokenUsage = promptTokens + completionTokens;

    // Latency
    const latencies = llmLogs
      .map(l => l.payload.latencyMs as number)
      .filter((v): v is number => typeof v === 'number' && v > 0);
    const avgLatencyMs = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

    // Provider breakdown
    const providerMap = new Map<string, ProviderBreakdown>();
    for (const l of llmLogs) {
      const provider = (l.payload.provider as string) || 'unknown';
      const model = (l.payload.model as string) || 'unknown';
      const key = `${provider}:${model}`;
      const existing = providerMap.get(key);
      const prompt = (l.payload.usage as any)?.promptTokens || 0;
      const completion = (l.payload.usage as any)?.completionTokens || 0;

      if (existing) {
        existing.promptTokens += prompt;
        existing.completionTokens += completion;
        existing.totalTokens += prompt + completion;
        existing.calls += 1;
        existing.estimatedCostUsd = estimateCostUsd(provider, existing.promptTokens, existing.completionTokens);
      } else {
        providerMap.set(key, {
          provider,
          model,
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: prompt + completion,
          estimatedCostUsd: estimateCostUsd(provider, prompt, completion),
          calls: 1,
        });
      }
    }

    // Total cost
    const totalCostUsd = Array.from(providerMap.values()).reduce((acc, p) => acc + p.estimatedCostUsd, 0);

    // Tool calls
    const toolLogs = logs.filter(l => l.type === 'tool');
    const toolErrorCount = toolLogs.filter(l => !l.payload.success).length;

    return {
      id: agentId,
      startTime: logs[0].timestamp,
      lastUpdateTime: logs[logs.length - 1].timestamp,
      task: (startEvent?.payload.task as string) || 'Task',
      status,
      tokenUsage,
      promptTokens,
      completionTokens,
      estimatedCostUsd: totalCostUsd,
      avgLatencyMs,
      providerBreakdown: Array.from(providerMap.values()),
      toolCallCount: toolLogs.length,
      toolErrorCount,
      success: status === 'completed',
    };
  }

  async clearSessions(): Promise<void> {
    const files = await fs.readdir(this.logDirectory);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    await Promise.all(jsonlFiles.map(file => fs.unlink(path.join(this.logDirectory, file))));
  }

  async deleteSession(agentId: string): Promise<void> {
    const filePath = path.join(this.logDirectory, `${agentId}.jsonl`);
    await fs.unlink(filePath).catch(() => {});
  }
}
