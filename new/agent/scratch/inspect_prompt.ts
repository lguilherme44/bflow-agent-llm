import { createDevelopmentToolRegistry } from './src/tools/development-tools.js';

const registry = createDevelopmentToolRegistry({ workspaceRoot: process.cwd() });
console.log(registry.generateToolPrompt());
