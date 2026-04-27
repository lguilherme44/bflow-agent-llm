/**
 * CLI Context — auto-detects project type, language, framework,
 * and adapts the agent's behavior accordingly.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export interface ProjectContext {
  /** Detected primary language */
  language: 'typescript' | 'javascript' | 'python' | 'sql' | 'unknown';
  /** Detected framework */
  framework?: string;
  /** Package manager */
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'pip' | 'poetry' | 'uv';
  /** Test framework */
  testFramework?: 'vitest' | 'jest' | 'pytest' | 'unittest' | 'none';
  /** Linter/formatter */
  formatter?: 'prettier' | 'eslint' | 'ruff' | 'black' | 'none';
  /** Infrastructure */
  infrastructure?: 'docker' | 'kubernetes' | 'terraform' | 'serverless' | 'none';
  /** Database (if detected) */
  database?: 'postgresql' | 'mysql' | 'mongodb' | 'sqlite' | 'none';
  /** Cloud provider */
  cloud?: 'aws' | 'gcp' | 'azure' | 'none';
  /** Runtime config */
  runtime: {
    nodeVersion?: string;
    pythonVersion?: string;
  };
}

/**
 * Detect project context from the current working directory.
 */
export async function detectProjectContext(cwd: string): Promise<ProjectContext> {
  const ctx: ProjectContext = {
    language: 'unknown',
    runtime: {},
  };

  // Check package.json (Node/TS project)
  try {
    const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf-8'));
    ctx.language = 'typescript'; // Default for Node projects
    ctx.packageManager = await detectPackageManager(cwd);

    // Framework detection
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps?.next) ctx.framework = 'nextjs';
    else if (deps?.react) ctx.framework = 'react';
    else if (deps?.vue) { ctx.language = 'javascript'; ctx.framework = 'vue'; }
    else if (deps?.express || deps?.fastify) ctx.framework = 'express';
    else if (deps?.nestjs) ctx.framework = 'nestjs';

    // Test framework
    if (deps?.vitest) ctx.testFramework = 'vitest';
    else if (deps?.jest) ctx.testFramework = 'jest';

    // Formatter
    if (deps?.prettier) ctx.formatter = 'prettier';
    if (deps?.eslint) ctx.formatter = ctx.formatter ? ctx.formatter : 'eslint';

    // Database
    if (deps?.pg || deps?.postgres) ctx.database = 'postgresql';
    else if (deps?.mysql2) ctx.database = 'mysql';
    else if (deps?.mongodb || deps?.mongoose) ctx.database = 'mongodb';
    else if (deps?.['better-sqlite3']) ctx.database = 'sqlite';

    // Cloud
    if (deps?.['@aws-sdk/client-s3'] || deps?.aws) ctx.cloud = 'aws';
    else if (deps?.['@google-cloud/storage']) ctx.cloud = 'gcp';
    else if (deps?.['@azure/storage-blob']) ctx.cloud = 'azure';

  } catch {}

  // Check pyproject.toml (Python project)
  if (ctx.language === 'unknown') {
    try {
      const pyproject = await readFile(path.join(cwd, 'pyproject.toml'), 'utf-8');
      ctx.language = 'python';

      if (pyproject.includes('[tool.poetry]')) ctx.packageManager = 'poetry';
      else if (pyproject.includes('[tool.uv]')) ctx.packageManager = 'uv';
      else ctx.packageManager = 'pip';

      if (pyproject.includes('django')) ctx.framework = 'django';
      else if (pyproject.includes('fastapi')) ctx.framework = 'fastapi';
      else if (pyproject.includes('flask')) ctx.framework = 'flask';

      if (pyproject.includes('pytest')) ctx.testFramework = 'pytest';
      if (pyproject.includes('[tool.ruff]')) ctx.formatter = 'ruff';
      else if (pyproject.includes('[tool.black]')) ctx.formatter = 'black';

      if (pyproject.includes('psycopg') || pyproject.includes('asyncpg')) ctx.database = 'postgresql';
    } catch {}
  }

  // Detect infrastructure files
  try {
    await stat(path.join(cwd, 'Dockerfile'));
    ctx.infrastructure = 'docker';
  } catch {}
  try {
    await stat(path.join(cwd, 'docker-compose.yml'));
    ctx.infrastructure = 'docker';
  } catch {}
  try {
    await stat(path.join(cwd, 'k8s'));
    ctx.infrastructure = ctx.infrastructure || 'kubernetes';
  } catch {}
  try {
    const files = await readFile(path.join(cwd, '.'), 'utf-8').catch(() => '');
    if (files.includes('.tf')) ctx.infrastructure = ctx.infrastructure || 'terraform';
  } catch {}

  // Detect AWS config
  try {
    await stat(path.join(cwd, '.aws'));
    ctx.cloud = ctx.cloud || 'aws';
  } catch {}
  try {
    await stat(path.join(cwd, 'serverless.yml'));
    ctx.infrastructure = ctx.infrastructure || 'serverless';
  } catch {}

  return ctx;
}

async function detectPackageManager(cwd: string): Promise<'npm' | 'yarn' | 'pnpm'> {
  try { await stat(path.join(cwd, 'pnpm-lock.yaml')); return 'pnpm'; } catch {}
  try { await stat(path.join(cwd, 'yarn.lock')); return 'yarn'; } catch {}
  return 'npm';
}

/**
 * Generate a context-aware system prompt based on detected project.
 */
export function generateContextualPrompt(ctx: ProjectContext): string {
  const parts: string[] = [];

  parts.push(`You are working on a ${ctx.language} project.`);

  if (ctx.framework) parts.push(`Framework: ${ctx.framework}.`);
  if (ctx.packageManager) parts.push(`Package manager: ${ctx.packageManager}.`);
  if (ctx.testFramework) parts.push(`Tests: ${ctx.testFramework}.`);
  if (ctx.formatter) parts.push(`Formatter/Linter: ${ctx.formatter}.`);
  if (ctx.database && ctx.database !== 'none') parts.push(`Database: ${ctx.database}.`);
  if (ctx.cloud && ctx.cloud !== 'none') parts.push(`Cloud: ${ctx.cloud}.`);
  if (ctx.infrastructure && ctx.infrastructure !== 'none') parts.push(`Infrastructure: ${ctx.infrastructure}.`);

  // Language-specific rules
  if (ctx.language === 'typescript') {
    parts.push('\nTypeScript rules:');
    parts.push('- Always run `npm run typecheck` before committing.');
    parts.push('- Use strict types, avoid `any`.');
    parts.push('- Prefer `interface` over `type` for object shapes.');
  } else if (ctx.language === 'python') {
    parts.push('\nPython rules:');
    parts.push('- Use type hints (PEP 484).');
    parts.push('- Format with ruff/black before committing.');
    parts.push('- Use pathlib for file paths, not os.path.');
  }

  return parts.join('\n');
}
