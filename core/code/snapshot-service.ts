/**
 * File Snapshot Service — captures file state before edits for rollback.
 */
import * as fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashContent } from '../code/source.js';

export interface FileSnapshot {
  id: string;
  filepath: string;
  content: string;
  hash: string;
  takenAt: string;
  reason?: string;
}

export interface SnapshotRestoreResult {
  restored: string[];
  failed: Array<{ filepath: string; error: string }>;
  skipped: string[];
}

export class SnapshotService {
  private readonly snapshots = new Map<string, FileSnapshot[]>();
  private readonly storageDir: string;

  constructor(workspaceRoot: string) {
    this.storageDir = path.join(workspaceRoot, '.agent', 'snapshots');
  }

  /** Take a snapshot of a file before editing. */
  async take(filepath: string, reason?: string): Promise<FileSnapshot> {
    const content = await fs.readFile(filepath, 'utf-8');
    const hash = hashContent(content);
    const snapshot: FileSnapshot = {
      id: randomUUID(),
      filepath,
      content,
      hash,
      takenAt: new Date().toISOString(),
      reason,
    };

    const existing = this.snapshots.get(filepath) || [];
    existing.push(snapshot);
    this.snapshots.set(filepath, existing);

    // Also persist to disk
    await this.persistSnapshot(snapshot);

    return snapshot;
  }

  /** Restore a file to its most recent snapshot. */
  async restore(filepath: string): Promise<boolean> {
    const snapshots = this.snapshots.get(filepath);
    if (!snapshots || snapshots.length === 0) return false;

    const latest = snapshots[snapshots.length - 1];
    await fs.writeFile(filepath, latest.content, 'utf-8');
    return true;
  }

  /** Restore all files to their snapshots. */
  async restoreAll(): Promise<SnapshotRestoreResult> {
    const result: SnapshotRestoreResult = { restored: [], failed: [], skipped: [] };
    
    for (const [filepath, snapshots] of this.snapshots) {
      if (snapshots.length === 0) continue;
      try {
        await fs.writeFile(filepath, snapshots[snapshots.length - 1].content, 'utf-8');
        result.restored.push(filepath);
      } catch (err) {
        result.failed.push({ filepath, error: String(err) });
      }
    }

    return result;
  }

  /** Get all snapshots for a file. */
  getSnapshots(filepath: string): FileSnapshot[] {
    return this.snapshots.get(filepath) || [];
  }

  /** Clear all snapshots. */
  clear(): void {
    this.snapshots.clear();
  }

  private async persistSnapshot(snapshot: FileSnapshot): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      const filename = `${snapshot.filepath.replace(/[\/\\:]/g, '_')}.${snapshot.id.slice(0, 8)}.json`;
      await fs.writeFile(
        path.join(this.storageDir, filename),
        JSON.stringify(snapshot, null, 2),
        'utf-8'
      );
    } catch {
      // Non-fatal: in-memory snapshots still work
    }
  }
}

/**
 * Validate package-lock.json integrity after dependency changes.
 */
export async function validatePackageLock(workspaceRoot: string): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    const lockPath = path.join(workspaceRoot, 'package-lock.json');
    const pkgPath = path.join(workspaceRoot, 'package.json');
    
    const lockExists = statSync(lockPath).isFile();
    const pkgExists = statSync(pkgPath).isFile();

    if (!lockExists) {
      errors.push('package-lock.json não encontrado');
      return { valid: false, errors };
    }
    if (!pkgExists) {
      errors.push('package.json não encontrado');
      return { valid: false, errors };
    }

    // Basic check: lockfile is valid JSON
    const lockContent = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
    if (!lockContent.packages && !lockContent.dependencies) {
      errors.push('package-lock.json não contém "packages" ou "dependencies"');
    }

    // Check lockfile version
    if (lockContent.lockfileVersion === undefined) {
      errors.push('package-lock.json sem lockfileVersion');
    }

  } catch (err) {
    errors.push(`Erro ao validar package-lock: ${String(err)}`);
  }

  return { valid: errors.length === 0, errors };
}
