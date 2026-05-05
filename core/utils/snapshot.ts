import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Snapshot {
  id: string;
  filepath: string;
  content: string;
  timestamp: string;
}

export class SnapshotService {
  private readonly snapshotDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.snapshotDir = path.join(baseDir, '.agent', 'snapshots');
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.snapshotDir, { recursive: true });
  }

  async createSnapshot(filepath: string, content: string): Promise<string> {
    await this.ensureDir();
    const id = randomUUID();
    const filename = `${id}_${path.basename(filepath)}.bak`;
    const snapshotPath = path.join(this.snapshotDir, filename);

    const metadata = {
      id,
      filepath: path.resolve(filepath),
      timestamp: new Date().toISOString(),
    };

    await fs.writeFile(snapshotPath, content);
    await fs.writeFile(`${snapshotPath}.json`, JSON.stringify(metadata, null, 2));

    return id;
  }

  async listSnapshots(filepath?: string): Promise<Snapshot[]> {
    try {
      const files = await fs.readdir(this.snapshotDir);
      const snapshots: Snapshot[] = [];

      for (const file of files) {
        if (file.endsWith('.bak')) {
          const snapshotPath = path.join(this.snapshotDir, file);
          const metaPath = `${snapshotPath}.json`;
          
          try {
            const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
            if (!filepath || meta.filepath === path.resolve(filepath)) {
              const content = await fs.readFile(snapshotPath, 'utf8');
              snapshots.push({
                ...meta,
                content,
              });
            }
          } catch {
            // Ignore corrupted or missing metadata
          }
        }
      }

      return snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    } catch {
      return [];
    }
  }

  async restoreSnapshot(id: string): Promise<void> {
    const snapshots = await this.listSnapshots();
    const snapshot = snapshots.find((s) => s.id === id);

    if (!snapshot) {
      throw new Error(`Snapshot with ID ${id} not found.`);
    }

    await fs.writeFile(snapshot.filepath, snapshot.content);
  }
}
