/**
 * Multi-Project Workspace — manages multiple project directories,
 * keeping RAG indexes separate and switching context efficiently.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LocalRagService } from '../rag/local-rag.js';
import { TreeSitterParserService } from '../code/tree-sitter-parser.js';

export interface ProjectInfo {
  name: string;
  path: string;
  language: string;
  framework?: string;
  lastIndexed?: string;
  fileCount: number;
  description?: string;
}

export interface WorkspaceConfig {
  /** Root directory for all projects */
  projectsRoot: string;
  /** Currently active project */
  activeProject?: string;
  /** List of known projects */
  projects: ProjectInfo[];
}

export class MultiProjectWorkspace {
  private rags = new Map<string, LocalRagService>();
  private parser = new TreeSitterParserService();
  private config: WorkspaceConfig;

  constructor(projectsRoot: string) {
    this.config = { projectsRoot, projects: [] };
  }

  /** Scan projectsRoot and discover all projects */
  async discover(): Promise<ProjectInfo[]> {
    const entries = await fs.readdir(this.config.projectsRoot, { withFileTypes: true });
    const projects: ProjectInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const projPath = path.join(this.config.projectsRoot, entry.name);
      
      // Check if it's a recognizable project
      const hasPackageJson = await fs.stat(path.join(projPath, 'package.json')).then(() => true).catch(() => false);
      const hasPyProject = await fs.stat(path.join(projPath, 'pyproject.toml')).then(() => true).catch(() => false);
      const hasGit = await fs.stat(path.join(projPath, '.git')).then(() => true).catch(() => false);
      void hasGit; // Used for future filtering

      if (hasPackageJson || hasPyProject) {
        let language = 'unknown';
        let framework: string | undefined;

        if (hasPackageJson) {
          try {
            const pkg = JSON.parse(await fs.readFile(path.join(projPath, 'package.json'), 'utf-8'));
            language = 'typescript'; // Default for Node projects
            if (pkg.dependencies?.react) framework = 'react';
            if (pkg.dependencies?.next) framework = 'nextjs';
            if (pkg.dependencies?.express) framework = 'express';
            if (pkg.dependencies?.vue) { language = 'javascript'; framework = 'vue'; }
          } catch {}
        } else if (hasPyProject) {
          language = 'python';
          try {
            const content = await fs.readFile(path.join(projPath, 'pyproject.toml'), 'utf-8');
            if (content.includes('django')) framework = 'django';
            if (content.includes('fastapi')) framework = 'fastapi';
            if (content.includes('flask')) framework = 'flask';
          } catch {}
        }

        // Count files
        const fileCount = await this.countFiles(projPath);

        projects.push({
          name: entry.name,
          path: projPath,
          language,
          framework,
          fileCount,
          description: `${language}${framework ? ` (${framework})` : ''} project with ${fileCount} files`,
        });
      }
    }

    this.config.projects = projects;
    return projects;
  }

  /** Get or create RAG service for a project */
  async getRag(projectPath: string): Promise<LocalRagService> {
    const key = path.resolve(projectPath);
    let rag = this.rags.get(key);
    if (!rag) {
      rag = new LocalRagService(key, this.parser);
      this.rags.set(key, rag);
    }
    return rag;
  }

  /** Index a specific project */
  async indexProject(projectPath: string): Promise<{ filesIndexed: number; chunksIndexed: number }> {
    const rag = await this.getRag(projectPath);
    const stats = await rag.indexWorkspace('.');
    return { filesIndexed: stats.filesIndexed, chunksIndexed: stats.chunksIndexed };
  }

  /** Index all discovered projects */
  async indexAll(onProgress?: (project: string, done: number, total: number) => void): Promise<void> {
    const projects = this.config.projects.length > 0 ? this.config.projects : await this.discover();
    for (let i = 0; i < projects.length; i++) {
      onProgress?.(projects[i].name, i, projects.length);
      await this.indexProject(projects[i].path);
    }
  }

  /** Set the active project for contextual operations */
  setActive(projectPath: string): void {
    this.config.activeProject = path.resolve(projectPath);
  }

  /** Get the active project's RAG */
  getActiveRag(): LocalRagService | null {
    if (!this.config.activeProject) return null;
    return this.rags.get(this.config.activeProject) || null;
  }

  /** Search across all project RAGs */
  async searchAll(query: string, limit = 5): Promise<Array<{ project: string; results: any[] }>> {
    const allResults: Array<{ project: string; results: any[] }> = [];
    for (const [projPath, rag] of this.rags) {
      const results = await rag.retrieveHybrid({ task: query, limit });
      if (results.length > 0) {
        allResults.push({
          project: path.basename(projPath),
          results: results.map(r => ({
            filepath: r.chunk.metadata.filepath,
            score: r.score,
            reasons: r.reasons,
            symbols: r.chunk.metadata.symbols.slice(0, 3),
          })),
        });
      }
    }
    return allResults.sort((a, b) => b.results[0]?.score - a.results[0]?.score);
  }

  getProjects(): ProjectInfo[] {
    return this.config.projects;
  }

  private async countFiles(dir: string): Promise<number> {
    let count = 0;
    const ignored = new Set(['node_modules', 'dist', '.git', '.agent', '__pycache__', '.venv', 'venv', 'build', '.next']);

    async function walk(current: string): Promise<void> {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (ignored.has(entry.name)) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) { await walk(full); }
        else { count++; }
      }
    }

    await walk(dir);
    return count;
  }
}

/** Global singleton for convenience */
let globalWorkspace: MultiProjectWorkspace | null = null;

export function getGlobalWorkspace(projectsRoot?: string): MultiProjectWorkspace {
  if (!globalWorkspace || projectsRoot) {
    globalWorkspace = new MultiProjectWorkspace(projectsRoot || process.cwd());
  }
  return globalWorkspace;
}
