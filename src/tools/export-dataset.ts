import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface LogEntry {
  timestamp: string;
  type: 'event' | 'llm' | 'tool' | 'command' | 'file';
  agentId?: string;
  payload: any;
}

const LOG_DIR = path.join(process.cwd(), '.agent', 'logs');
const EXPORT_DIR = path.join(process.cwd(), 'datasets');

async function exportDataset() {
  console.log('🚀 Iniciando exportação de dataset...');
  
  try {
    await fs.mkdir(EXPORT_DIR, { recursive: true });
    const files = await fs.readdir(LOG_DIR);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    
    const dataset: any[] = [];

    for (const file of jsonlFiles) {
      const filePath = path.join(LOG_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as LogEntry);
      
      // Relaxed criteria: we export if it has assistant content, even if not explicitly "completed" yet
      const hasAssistantContent = lines.some(l => l.type === 'event' && l.payload.event === 'llm_content_debug');
      const hasSuccess = lines.some(l => 
        l.type === 'event' && ['orchestrator_completed', 'task_completed', 'phase_completed'].includes(l.payload.event)
      );

      if (!hasAssistantContent) continue;

      let task = lines.find(l => l.type === 'event' && l.payload.event === 'orchestrator_started')?.payload.task;
      
      // Heurística secundária: se não encontrar o evento oficial, tenta extrair do primeiro thought ou do histórico
      if (!task) {
        const firstThought = lines.find(l => l.type === 'event' && l.payload.event === 'llm_content_debug')?.payload.content;
        if (firstThought) {
          task = `Tarefa recuperada dos logs: ${firstThought.slice(0, 100)}...`;
        } else {
          task = `Tarefa (ID: ${file.replace('.jsonl', '')})`;
        }
      }

      // Construímos a conversa para o fine-tuning
      const messages = [
        { role: 'system', content: 'Você é um agente autônomo poderoso. Use tags <think> para raciocinar antes de responder ou usar ferramentas.' },
        { role: 'user', content: task }
      ];

      // Agrupamos os conteúdos do LLM
      let assistantContent = '';
      for (const line of lines) {
        if (line.type === 'event' && line.payload.event === 'llm_content_debug') {
          assistantContent += line.payload.content + '\n';
        }
      }

      if (assistantContent.trim()) {
        messages.push({ role: 'assistant', content: assistantContent.trim() });
        dataset.push({ messages });
      }
    }

    const exportPath = path.join(EXPORT_DIR, `agent_traces_${new Date().toISOString().split('T')[0]}.jsonl`);
    await fs.writeFile(exportPath, dataset.map(d => JSON.stringify(d)).join('\n'));
    
    console.log(`✅ Exportação concluída! ${dataset.length} exemplos exportados para ${exportPath}`);
  } catch (error) {
    console.error('❌ Erro na exportação:', error);
  }
}

exportDataset();
