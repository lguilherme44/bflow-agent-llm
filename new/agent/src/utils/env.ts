import fs from 'node:fs';
import path from 'node:path';

/**
 * A simple, dependency-free .env file loader.
 * Populates process.env with variables from a .env file if it exists.
 */
export function loadEnv(workspaceRoot: string = process.cwd()): void {
  const envPath = path.join(workspaceRoot, '.env');
  
  if (!fs.existsSync(envPath)) {
    return;
  }

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      // Skip comments and empty lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Find first '=' character
      const index = trimmed.indexOf('=');
      if (index === -1) continue;

      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();

      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Only set if not already present in environment
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    console.warn('Falha ao carregar arquivo .env:', error);
  }
}
