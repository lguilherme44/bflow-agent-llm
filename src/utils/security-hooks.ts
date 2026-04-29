/**
 * Security Hooks — PreToolUse patterns para detectar vulnerabilidades web.
 *
 * Inspirado no security-guidance plugin do Claude Code.
 * Monitora: XSS, SQL injection, command injection, eval, pickle, hardcoded secrets.
 */
import { HookRule } from '../types/index.js';

export const SECURITY_HOOKS: HookRule[] = [
  // ── XSS ──────────────────────────────────────────────────
  {
    id: 'sec-xss-innerhtml',
    name: 'XSS: innerHTML assignment',
    description: 'Detecta atribuição direta a innerHTML — usar textContent ou sanitização',
    type: 'pre_tool',
    action: 'warn',
    pattern: '\\.innerHTML\\s*=',
    message: '⚠️ XSS risk: innerHTML assignment detected. Use textContent or DOMPurify.sanitize() instead.',
    toolFilter: ['write_file', 'edit_file_ast'],
  },
  {
    id: 'sec-xss-dangerously',
    name: 'XSS: dangerouslySetInnerHTML',
    description: 'Detecta dangerouslySetInnerHTML no React',
    type: 'pre_tool',
    action: 'warn',
    pattern: 'dangerouslySetInnerHTML',
    message: '⚠️ XSS risk: dangerouslySetInnerHTML in React. Ensure content is sanitized with DOMPurify.',
    toolFilter: ['write_file', 'edit_file_ast'],
  },

  // ── SQL Injection ────────────────────────────────────────
  {
    id: 'sec-sqli-concat',
    name: 'SQL Injection: string concatenation',
    description: 'Detecta concatenação de strings em queries SQL',
    type: 'pre_tool',
    action: 'block',
    pattern: '(?:SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\\s.*[+`].*\\$\\{|SELECT.*\\+.*variable',
    message: '🚫 SQL Injection risk: string concatenation in SQL query. Use parameterized queries ($1, $2) or an ORM.',
    toolFilter: ['write_file', 'edit_file_ast'],
  },
  {
    id: 'sec-sqli-format',
    name: 'SQL Injection: template strings',
    description: 'Detecta template literals em queries SQL',
    type: 'pre_tool',
    action: 'warn',
    pattern: '`\\s*(?:SELECT|INSERT|UPDATE|DELETE)\\s.*\\$\\{',
    message: '⚠️ SQL Injection risk: template literal in SQL query. Use parameterized queries instead.',
    toolFilter: ['write_file', 'edit_file_ast'],
  },

  // ── Command Injection ─────────────────────────────────────
  {
    id: 'sec-cmd-exec',
    name: 'Command Injection: exec with user input',
    description: 'Detecta exec/execSync com concatenação de variáveis',
    type: 'pre_tool',
    action: 'warn',
    pattern: '(?:exec|execSync|spawn|child_process)\\([^)]*\\+[^)]*\\)',
    message: '⚠️ Command injection risk: string concatenation in exec(). Use execFile() or sanitize with shell-quote.',
    toolFilter: ['write_file', 'edit_file_ast'],
  },

  // ── Eval ──────────────────────────────────────────────────
  {
    id: 'sec-eval',
    name: 'Dangerous eval usage',
    description: 'Detecta eval() ou Function() com conteúdo dinâmico',
    type: 'pre_tool',
    action: 'block',
    pattern: '\\beval\\s*\\(|new\\s+Function\\s*\\(',
    message: '🚫 eval() or new Function() detected. This is almost always a security vulnerability. Use JSON.parse or a sandboxed interpreter.',
    toolFilter: ['write_file', 'edit_file_ast'],
  },

  // ── Hardcoded Secrets ─────────────────────────────────────
  {
    id: 'sec-secrets-api-key',
    name: 'Hardcoded secrets: API keys',
    description: 'Detecta API keys hardcoded no código',
    type: 'pre_tool',
    action: 'warn',
    pattern: '(?:api_key|apiKey|API_KEY|secret_key|SECRET)\\s*[:=]\\s*["\'][A-Za-z0-9_\\-]{20,}',
    message: '⚠️ Hardcoded secret detected. Use environment variables (process.env.SECRET) instead.',
    toolFilter: ['write_file', 'edit_file_ast'],
  },
  {
    id: 'sec-secrets-password',
    name: 'Hardcoded secrets: passwords',
    description: 'Detecta senhas hardcoded',
    type: 'pre_tool',
    action: 'block',
    pattern: '(?:password|passwd|pwd)\\s*[:=]\\s*["\'][^"\']+["\']',
    message: '🚫 Hardcoded password detected. Use environment variables or a secrets manager.',
    toolFilter: ['write_file', 'edit_file_ast'],
  },

  // ── Path Traversal ────────────────────────────────────────
  {
    id: 'sec-path-traversal',
    name: 'Path traversal',
    description: 'Detecta concatenação de paths com input de usuário',
    type: 'pre_tool',
    action: 'warn',
    pattern: 'path\\.(?:join|resolve)\\([^)]*req\\.(?:query|params|body)',
    message: '⚠️ Path traversal risk: user input in file path. Use path.resolve() and validate against a whitelist.',
    toolFilter: ['write_file', 'edit_file_ast'],
  },

  // ── Open Redirect ─────────────────────────────────────────
  {
    id: 'sec-open-redirect',
    name: 'Open redirect',
    description: 'Detecta redirect com URL de query param',
    type: 'pre_tool',
    action: 'warn',
    pattern: '(?:res\\.redirect|window\\.location)\\s*\\(\\s*req\\.(?:query|params)',
    message: '⚠️ Open redirect risk: redirecting to user-supplied URL. Validate against a whitelist of allowed domains.',
    toolFilter: ['write_file', 'edit_file_ast'],
  },
];
