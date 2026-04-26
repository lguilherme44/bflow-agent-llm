import fs from 'node:fs';
import path from 'node:path';
import picocolors from 'picocolors';

export async function initProject(workspaceRoot: string) {
  const agentDir = path.join(workspaceRoot, '.agent');
  const checkpointsDir = path.join(agentDir, 'checkpoints');
  const logsDir = path.join(agentDir, 'logs');
  const rulesPath = path.join(workspaceRoot, '.agent-rules.md');
  const skillsPath = path.join(workspaceRoot, 'skills.md');
  const configPath = path.join(workspaceRoot, '.agentrc');

  console.log(picocolors.cyan(`\nIniciando configurao do agente em: ${workspaceRoot}`));

  // 1. Criar diretrios
  [agentDir, checkpointsDir, logsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(picocolors.green(`  [+] Diretorio criado: ${path.relative(workspaceRoot, dir)}`));
    }
  });

  // 2. Criar .agent-rules.md (Hooks)
  if (!fs.existsSync(rulesPath)) {
    const defaultRules = `
# Regras do Agente (Hooks)

Este arquivo define guardrails e filtros para as ferramentas do agente.

<!-- hook: prevent-env-leak -->
### Prevenir Vazamento de .env
- Type: pre_tool
- Action: block
- Pattern: /\\.env/
- Message: Nao e permitido ler ou modificar arquivos .env diretamente por seguranca.
- Tools: read_file, write_file, search_text

<!-- hook: warn-broad-delete -->
### Alerta para Delete Amplo
- Type: pre_tool
- Action: warn
- Pattern: /rm -rf \\/|del \\/s/
- Message: Comando de remocao detectado. Proceda com cautela.
- Tools: run_command
`.trim();
    fs.writeFileSync(rulesPath, defaultRules);
    console.log(picocolors.green(`  [+] Arquivo criado: .agent-rules.md`));
  }

  // 3. Criar skills.md (Contexto do Projeto)
  if (!fs.existsSync(skillsPath)) {
    const defaultSkills = `
# Skills do Projeto

Este arquivo fornece contexto semntico para o agente entender as convenes locais.

## Stack Tecnolgica
- Linguagem: TypeScript
- Node.js: >= 20
- Framework: (Descreva aqui, ex: Express, React, etc.)

## Padres de Cdigo
- Estilo: (Ex: Clean Code, SOLID)
- Commits: Conventional Commits
- Testes: (Ex: Vitest, Jest)

## Diretorios Importantes
- \`src/\`: Codigo fonte
- \`tests/\`: Testes unitarios e de integracao
`.trim();
    fs.writeFileSync(skillsPath, defaultSkills);
    console.log(picocolors.green(`  [+] Arquivo criado: skills.md`));
  }

  // 4. Criar .agentrc (Configurao)
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      provider: 'openai',
      model: 'gpt-5.4-mini',
      temperature: 0.2,
      maxTokens: 2048,
      sandbox: 'auto'
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(picocolors.green(`  [+] Arquivo criado: .agentrc`));
  }

  console.log(picocolors.cyan('\nConfigurao concluda com sucesso! 🚀'));
  console.log(`Use ${picocolors.bold('agent chat')} para iniciar uma conversa.\n`);
}
