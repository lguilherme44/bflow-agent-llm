import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentState } from '../types/index.js';
import { AgentStateMachine } from './machine.js';

export interface CheckpointListFilter {
  agentId?: string;
  taskIncludes?: string;
  status?: AgentState['status'];
}

export interface CheckpointDescriptor {
  id: string;
  filepath?: string;
  status: AgentState['status'];
  currentTask: string | null;
  checkpointVersion: number;
  schemaVersion: number;
  updatedAt: string;
}

export interface CheckpointEnvelope {
  schemaVersion: number;
  savedAt: string;
  state: AgentState;
}

export interface CheckpointStorage {
  save(id: string, state: AgentState): Promise<void>;
  load(id: string): Promise<AgentState | null>;
  list(filter?: CheckpointListFilter): Promise<CheckpointDescriptor[]>;
  delete(id: string): Promise<void>;
}

export class InMemoryCheckpointStorage implements CheckpointStorage {
  private readonly store = new Map<string, AgentState>();

  async save(id: string, state: AgentState): Promise<void> {
    AgentStateMachine.validateSerializable(state);
    this.store.set(id, this.clone(state));
  }

  async load(id: string): Promise<AgentState | null> {
    const state = this.store.get(id);
    return state ? this.clone(state) : null;
  }

  async list(filter?: CheckpointListFilter): Promise<CheckpointDescriptor[]> {
    return Array.from(this.store.values())
      .filter((state) => this.matchesFilter(state, filter))
      .map((state) => this.describe(state));
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  private clone(state: AgentState): AgentState {
    return JSON.parse(JSON.stringify(state)) as AgentState;
  }

  private matchesFilter(state: AgentState, filter?: CheckpointListFilter): boolean {
    if (!filter) {
      return true;
    }

    if (filter.agentId && state.id !== filter.agentId) {
      return false;
    }

    if (filter.status && state.status !== filter.status) {
      return false;
    }

    if (filter.taskIncludes && !state.currentTask?.includes(filter.taskIncludes)) {
      return false;
    }

    return true;
  }

  private describe(state: AgentState): CheckpointDescriptor {
    return {
      id: state.id,
      status: state.status,
      currentTask: state.currentTask,
      checkpointVersion: state.metadata.checkpointVersion,
      schemaVersion: state.metadata.schemaVersion,
      updatedAt: state.metadata.updatedAt,
    };
  }
}

export class FileCheckpointStorage implements CheckpointStorage {
  constructor(private readonly directory: string = path.resolve(process.cwd(), '.agent-checkpoints')) {}

  async save(id: string, state: AgentState): Promise<void> {
    AgentStateMachine.validateSerializable(state);
    await mkdir(this.directory, { recursive: true });

    const filepath = this.filepathFor(id);
    const tempPath = `${filepath}.${process.pid}.${Date.now()}.tmp`;
    const envelope: CheckpointEnvelope = {
      schemaVersion: AgentStateMachine.CURRENT_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      state,
    };

    await writeFile(tempPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    
    // Windows can be finicky with renames if a file is being scanned or indexed.
    // We use a retry loop to handle transient EPERM/EBUSY errors.
    let lastError: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rename(tempPath, filepath);
        return;
      } catch (error) {
        lastError = error;
        const isTransient = typeof error === 'object' && error !== null && 'code' in error && 
          (error.code === 'EPERM' || error.code === 'EBUSY');
        
        if (!isTransient || attempt === 4) {
          break;
        }
        
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }

    // Fallback: if rename still fails, try copy + unlink
    try {
      await writeFile(filepath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
      await rm(tempPath, { force: true });
    } catch (error) {
      throw lastError || error;
    }
  }

  async load(id: string): Promise<AgentState | null> {
    const filepath = this.filepathFor(id);

    try {
      const raw = await readFile(filepath, 'utf8');
      return this.parseCheckpoint(raw, filepath);
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async list(filter?: CheckpointListFilter): Promise<CheckpointDescriptor[]> {
    await mkdir(this.directory, { recursive: true });
    const entries = await readdir(this.directory, { withFileTypes: true });
    const descriptors: CheckpointDescriptor[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const filepath = path.join(this.directory, entry.name);
      const raw = await readFile(filepath, 'utf8');
      const state = this.parseCheckpoint(raw, filepath);

      if (this.matchesFilter(state, filter)) {
        descriptors.push({
          id: state.id,
          filepath,
          status: state.status,
          currentTask: state.currentTask,
          checkpointVersion: state.metadata.checkpointVersion,
          schemaVersion: state.metadata.schemaVersion,
          updatedAt: state.metadata.updatedAt,
        });
      }
    }

    return descriptors.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async delete(id: string): Promise<void> {
    await rm(this.filepathFor(id), { force: true });
  }

  private parseCheckpoint(raw: string, filepath: string): AgentState {
    const parsed = JSON.parse(raw) as Partial<CheckpointEnvelope> | AgentState;
    const state = 'state' in parsed ? parsed.state : parsed;

    if (!state || typeof state !== 'object') {
      throw new Error(`Invalid checkpoint in ${filepath}: missing state`);
    }

    this.validateState(state as AgentState, filepath);
    return state as AgentState;
  }

  private validateState(state: AgentState, filepath: string): void {
    if (state.metadata.schemaVersion !== AgentStateMachine.CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported checkpoint schema in ${filepath}: ${state.metadata.schemaVersion}`
      );
    }

    if (!state.id || !state.metadata || !state.messages || !state.toolHistory) {
      throw new Error(`Invalid checkpoint in ${filepath}: required fields are missing`);
    }

    AgentStateMachine.validateSerializable(state);
  }

  private matchesFilter(state: AgentState, filter?: CheckpointListFilter): boolean {
    if (!filter) {
      return true;
    }

    if (filter.agentId && state.id !== filter.agentId) {
      return false;
    }

    if (filter.status && state.status !== filter.status) {
      return false;
    }

    if (filter.taskIncludes && !state.currentTask?.includes(filter.taskIncludes)) {
      return false;
    }

    return true;
  }

  private filepathFor(id: string): string {
    const safeId = id.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(this.directory, `${safeId}.json`);
  }
}

export class CheckpointManager {
  constructor(private readonly storage: CheckpointStorage = new InMemoryCheckpointStorage()) {}

  async checkpoint(state: AgentState): Promise<void> {
    await this.storage.save(state.id, state);
  }

  async restore(agentId: string): Promise<AgentState | null> {
    return this.storage.load(agentId);
  }

  async list(filter?: CheckpointListFilter): Promise<CheckpointDescriptor[]> {
    return this.storage.list(filter);
  }

  async resumeFromCheckpoint(agentId: string, reason = 'process restart'): Promise<AgentState | null> {
    const state = await this.restore(agentId);
    if (!state) {
      return null;
    }

    if (state.status === 'awaiting_human' && state.pendingHumanApproval && !state.pendingHumanApproval.resolved) {
      return AgentStateMachine.recoverForResume(state, `${reason}; pending human approval preserved`);
    }

    if (state.status === 'thinking' || state.status === 'acting') {
      return AgentStateMachine.recoverForResume(state, `${reason}; interrupted ${state.status} step recovered`);
    }

    return AgentStateMachine.recoverForResume(state, reason);
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
