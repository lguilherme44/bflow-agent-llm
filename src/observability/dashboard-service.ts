import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LogEntry } from './logger.js';

export interface SessionMetadata {
  id: string;
  startTime: string;
  lastUpdateTime: string;
  task: string;
  status: 'completed' | 'error' | 'in_progress';
  tokenUsage: number;
  success: boolean;
}

export interface DashboardStats {
  totalSessions: number;
  successRate: number;
  errorRate: number;
  totalTokens: number;
  avgLatencyMs: number;
}

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

  async getStats(): Promise<DashboardStats> {
    const sessions = await this.listSessions();
    if (sessions.length === 0) {
      return { totalSessions: 0, successRate: 0, errorRate: 0, totalTokens: 0, avgLatencyMs: 0 };
    }

    const completed = sessions.filter(s => s.status === 'completed').length;
    const errors = sessions.filter(s => s.status === 'error').length;
    const totalTokens = sessions.reduce((acc, s) => acc + s.tokenUsage, 0);

    return {
      totalSessions: sessions.length,
      successRate: (completed / sessions.length) * 100,
      errorRate: (errors / sessions.length) * 100,
      totalTokens,
      avgLatencyMs: 0, // Need more data to calculate this accurately
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
            success: false
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
        status = 'completed'; // Assume completed if inactive for a long time
    }

    const tokenUsage = logs
        .filter(l => l.type === 'llm')
        .reduce((acc, l) => acc + (l.payload.usage as any)?.totalTokens || 0, 0);

    return {
      id: agentId,
      startTime: logs[0].timestamp,
      lastUpdateTime: logs[logs.length - 1].timestamp,
      task: (startEvent?.payload.task as string) || 'Task',
      status,
      tokenUsage,
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
