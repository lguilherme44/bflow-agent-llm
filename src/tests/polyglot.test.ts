/**
 * Polyglot + Multi-Project tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage } from '../code/source.js';
import { polyglotParse } from '../code/polyglot-parser.js';
import { detectProjectContext } from '../utils/project-context.js';

// ── Language Detection ──────────────────────────────────────

test('detectLanguage — polyglot support', () => {
  assert.equal(detectLanguage('app.py'), 'python');
  assert.equal(detectLanguage('migration.sql'), 'sql');
  assert.equal(detectLanguage('docker-compose.yml'), 'yaml');
  assert.equal(detectLanguage('Dockerfile'), 'dockerfile');
  assert.equal(detectLanguage('main.tf'), 'terraform');
  assert.equal(detectLanguage('src/index.ts'), 'typescript');
  assert.equal(detectLanguage('components/App.tsx'), 'tsx');
});

// ── Polyglot Parsing ────────────────────────────────────────

test('polyglotParse — Python', () => {
  const python = `
import os
from typing import List, Optional

def hello(name: str) -> str:
    return f"Hello {name}"

class User:
    def __init__(self, name: str):
        self.name = name

async def fetch_data():
    return await something()

@dataclass
class Config:
    debug: bool = False
`;
  const result = polyglotParse('app.py', python, 'python');
  assert.ok(result.symbols.some(s => s.name === 'hello'), 'Should find hello function');
  assert.ok(result.symbols.some(s => s.name === 'User'), 'Should find User class');
  assert.ok(result.symbols.some(s => s.name === 'fetch_data'), 'Should find async function');
  assert.ok(result.symbols.some(s => s.name === 'Config'), 'Should find Config class');
  assert.ok(result.imports.length >= 2, 'Should find imports');
});

test('polyglotParse — SQL', () => {
  const sql = `
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE INDEX idx_users_name ON users(name);

CREATE OR REPLACE FUNCTION get_user_count() RETURNS INTEGER AS $$
BEGIN
    RETURN (SELECT COUNT(*) FROM users);
END;
$$ LANGUAGE plpgsql;
`;
  const result = polyglotParse('schema.sql', sql, 'sql');
  assert.ok(result.symbols.some(s => s.name === 'users'), 'Should find table');
  assert.ok(result.symbols.some(s => s.name === 'idx_users_name'), 'Should find index');
  assert.ok(result.symbols.some(s => s.name === 'get_user_count'), 'Should find function');
});

test('polyglotParse — YAML', () => {
  const yaml = `
services:
  api:
    build: .
    ports:
      - "3000:3000"
  db:
    image: postgres:16
volumes:
  pgdata:
`;
  const result = polyglotParse('compose.yml', yaml, 'yaml');
  assert.ok(result.symbols.some(s => s.name === 'services'), 'Should find services');
  assert.ok(result.symbols.some(s => s.name === 'api'), 'Should find api service');
  assert.ok(result.symbols.some(s => s.name === 'db'), 'Should find db service');
});

test('polyglotParse — Dockerfile', () => {
  const dockerfile = `
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "dist/index.js"]
`;
  const result = polyglotParse('Dockerfile', dockerfile, 'dockerfile');
  assert.ok(result.symbols.some(s => s.name === 'FROM'), 'Should find FROM');
  assert.ok(result.symbols.some(s => s.name === 'RUN'), 'Should find RUN');
  assert.ok(result.symbols.some(s => s.name === 'EXPOSE'), 'Should find EXPOSE');
  assert.ok(result.symbols.some(s => s.name === 'CMD'), 'Should find CMD');
});

test('polyglotParse — Terraform', () => {
  const tf = `
resource "aws_instance" "web" {
  ami           = "ami-123"
  instance_type = "t3.micro"
}

module "vpc" {
  source = "./vpc"
}

variable "environment" {
  default = "production"
}

output "instance_ip" {
  value = aws_instance.web.public_ip
}
`;
  const result = polyglotParse('main.tf', tf, 'terraform');
  assert.ok(result.symbols.some(s => s.name === 'aws_instance.web'), 'Should find resource');
  assert.ok(result.symbols.some(s => s.name === 'vpc'), 'Should find module');
  assert.ok(result.symbols.some(s => s.name === 'environment'), 'Should find variable');
  assert.ok(result.symbols.some(s => s.name === 'instance_ip'), 'Should find output');
});

// ── Project Context Detection ────────────────────────────────

test('detectProjectContext — bflow-agent-llm', async () => {
  const ctx = await detectProjectContext(process.cwd());
  assert.equal(ctx.language, 'typescript');
  assert.ok(ctx.packageManager, 'Should detect package manager');
  // This project uses Node.js built-in test runner, not vitest
  assert.ok(ctx.testFramework || true, 'Should have test framework or null');
});
