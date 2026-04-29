/**
 * Cross-Project Context — connects knowledge across projects.
 *
 * Allows the agent to find patterns, migrations, and solutions
 * from previous projects and apply them to the current one.
 *
 * Example: "Essa migration do projeto A é parecida com a que fiz
 * no projeto B — reusa o padrão de índices compostos."
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { MultiProjectWorkspace } from './multi-project-workspace.js';

export interface CrossProjectMatch {
  sourceProject: string;
  sourceFile: string;
  targetProject: string;
  similarity: number; // 0-1
  pattern: string;
  suggestion: string;
}

export interface CrossProjectKnowledge {
  /** Shared patterns found across projects */
  patterns: Array<{
    name: string;
    description: string;
    projects: string[];
    files: string[];
    /** The actual pattern content (code snippet, config, etc.) */
    snippet: string;
  }>;
  /** Reusable templates from all projects */
  templates: Array<{
    name: string;
    project: string;
    filepath: string;
    content: string;
  }>;
}

export class CrossProjectContext {
  private knowledge: CrossProjectKnowledge = { patterns: [], templates: [] };
  private storageDir: string;

  constructor(private workspace: MultiProjectWorkspace, storageRoot?: string) {
    this.storageDir = path.join(storageRoot || workspace['config'].projectsRoot, '.agent', 'cross-project');
  }

  /**
   * Analyze all projects and find shared patterns.
   * Patterns include: migrations, configs, Dockerfiles, CI pipelines, API routes.
   */
  async analyze(): Promise<CrossProjectMatch[]> {
    const projects = this.workspace.getProjects();
    if (projects.length < 2) return [];

    const matches: CrossProjectMatch[] = [];

    for (let i = 0; i < projects.length; i++) {
      for (let j = i + 1; j < projects.length; j++) {
        const projA = projects[i];
        const projB = projects[j];

        // Compare languages — same language = more likely to share patterns
        if (projA.language === projB.language) {
          // Find common file patterns
          const ragA = await this.workspace.getRag(projA.path);
          const ragB = await this.workspace.getRag(projB.path);

          // Search for common infrastructure patterns
          const patterns = ['docker-compose', 'Dockerfile', 'migration', 'schema', '.env.example', 'Makefile', 'CI/CD', 'deploy'];

          for (const pattern of patterns) {
            try {
              const resultsA = await ragA.retrieveHybrid({ task: pattern, limit: 3 });
              const resultsB = await ragB.retrieveHybrid({ task: pattern, limit: 3 });

              if (resultsA.length > 0 && resultsB.length > 0) {
                matches.push({
                  sourceProject: projA.name,
                  sourceFile: resultsA[0].chunk.metadata.filepath,
                  targetProject: projB.name,
                  similarity: Math.min(resultsA[0].score, resultsB[0].score),
                  pattern,
                  suggestion: `Both ${projA.name} and ${projB.name} have ${pattern}. Consider extracting a shared template.`,
                });
              }
            } catch {}
          }
        }
      }
    }

    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Search for a pattern across all projects.
   * "Como esse erro foi resolvido em outros projetos?"
   */
  async findSimilarSolutions(query: string, currentProject: string): Promise<CrossProjectMatch[]> {
    const allResults = await this.workspace.searchAll(query, 5);
    const matches: CrossProjectMatch[] = [];

    for (const { project, results } of allResults) {
      if (project === currentProject) continue;
      for (const r of results) {
        matches.push({
          sourceProject: project,
          sourceFile: r.filepath,
          targetProject: currentProject,
          similarity: r.score,
          pattern: query,
          suggestion: `Found similar code in ${project}/${r.filepath} (score: ${r.score.toFixed(2)}). Consider reusing this pattern.`,
        });
      }
    }

    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Extract reusable templates from all projects (Dockerfiles, configs, CI).
   */
  async extractTemplates(): Promise<CrossProjectKnowledge['templates']> {
    const projects = this.workspace.getProjects();
    const templates: CrossProjectKnowledge['templates'] = [];

    const templatePatterns = ['Dockerfile', 'docker-compose.yml', 'Makefile', '.github/workflows', '.env.example'];

    for (const proj of projects) {
      for (const pattern of templatePatterns) {
        try {
          const rag = await this.workspace.getRag(proj.path);
          const results = await rag.retrieveHybrid({ task: pattern, limit: 1 });
          if (results.length > 0) {
            templates.push({
              name: pattern,
              project: proj.name,
              filepath: results[0].chunk.metadata.filepath,
              content: results[0].chunk.content.slice(0, 1000),
            });
          }
        } catch {}
      }
    }

    return templates;
  }

  /** Persist cross-project knowledge */
  async save(): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });
    await writeFile(
      path.join(this.storageDir, 'knowledge.json'),
      JSON.stringify(this.knowledge, null, 2)
    );
  }

  /** Load persisted knowledge */
  async load(): Promise<void> {
    try {
      const data = await readFile(path.join(this.storageDir, 'knowledge.json'), 'utf-8');
      this.knowledge = JSON.parse(data);
    } catch {}
  }
}
