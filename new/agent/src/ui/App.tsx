import { useState, useEffect, useMemo, memo } from 'react';
import { Text, Box, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { OrchestratorAgent, OrchestratorEvent } from '../agent/orchestrator.js';

interface AppProps {
  orchestrator: OrchestratorAgent;
  initialTask: string;
}

interface DisplayMessage {
  role: string;
  content: string;
  timestamp: string;
}

const MessageRow = memo(({ m, width }: { m: DisplayMessage; width: number }) => {
  const cleanContent = m.content.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
  
  const timestamp = m.timestamp.padEnd(10);
  const role = `[${m.role.toUpperCase()}]`.padEnd(13);
  
  // Calculamos o espaço restante e truncamos o conteúdo
  const availableWidth = width - timestamp.length - role.length - 2;
  const truncatedContent = cleanContent.length > availableWidth 
    ? cleanContent.slice(0, availableWidth - 3) + '...' 
    : cleanContent;

  // Renderizamos como uma única string para evitar sobreposição de caracteres no Windows
  const line = `${timestamp}${role} ${truncatedContent}`.padEnd(width);

  return (
    <Box height={1} width={width}>
      <Text color={m.role === 'system' ? 'blue' : m.role === 'assistant' ? 'green' : 'white'}>
        {line}
      </Text>
    </Box>
  );
});

MessageRow.displayName = 'MessageRow';

export const App = ({ orchestrator, initialTask }: AppProps) => {
  const { stdout } = useStdout();
  const terminalWidth = (stdout?.columns || 100) - 4;
  
  const [status, setStatus] = useState<'running' | 'completed' | 'error'>('running');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string>('Research');
  const [usage, setUsage] = useState({ totalTokens: 0 });
  const [error, setError] = useState<string | null>(null);

  const formatContent = useMemo(() => (content: string): string => {
    try {
      if (content.trim().startsWith('{')) {
        const parsed = JSON.parse(content);
        if (parsed.thought) return `Pensando: ${parsed.thought}`;
        if (parsed.action) return `Ação: ${parsed.action}`;
        if (parsed.summary) return `Resultado: ${parsed.summary}`;
        // Removido o 'final' para evitar alucinação do agente
      }
      return content;
    } catch {
      return content;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    orchestrator.setUpdateCallback((event: OrchestratorEvent) => {
      if (!isMounted) return;

      switch (event.type) {
        case 'phase_start':
          setCurrentPhase(event.phase);
          break;
        case 'phase_complete':
          if (event.phase === 'Finalized') {
            setStatus('completed');
            setCurrentPhase('Finalized');
          }
          break;
        case 'message_added':
          const now = new Date().toLocaleTimeString().split(' ')[0];
          setMessages(prev => [...prev, { 
            role: event.role, 
            content: formatContent(event.content),
            timestamp: now
          }].slice(-15));
          break;
        case 'usage_update':
          setUsage({ totalTokens: event.usage.totalTokens });
          break;
        case 'error':
          setStatus('error');
          setError(event.message);
          break;
      }
    });

    const runAgent = async () => {
      try {
        const { state } = await orchestrator.run(initialTask);
        if (isMounted) {
          if (state.status === 'completed') setStatus('completed');
          else if (state.status === 'error') setStatus('error');
        }
      } catch (err: any) {
        if (isMounted) {
          setStatus('error');
          setError(err.message);
        }
      }
    };

    runAgent();
    return () => { isMounted = false; };
  }, [orchestrator, initialTask, formatContent]);

  const horizontalLine = '─'.repeat(terminalWidth);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} width={terminalWidth + 4} height={26}>
      <Box marginBottom={1} justifyContent="center">
        <Text bold color="cyan" inverse> AGENT OS v1.0 </Text>
      </Box>

      <Box marginBottom={1}>
        <Text bold>Tarefa: </Text>
        <Text italic color="white">{initialTask.slice(0, terminalWidth - 10)}</Text>
      </Box>

      <Box marginBottom={1} justifyContent="space-between">
        <Box>
          <Text bold>STATUS: </Text>
          {status === 'running' && <Text color="yellow">RUNNING</Text>}
          {status === 'completed' && <Text color="green">COMPLETED</Text>}
          {status === 'error' && <Text color="red">ERROR</Text>}
          
          <Text bold>  PHASE: </Text>
          <Text color="blue">{currentPhase.toUpperCase()}</Text>
          {status === 'running' && <Text color="blue"> <Spinner type="dots" /></Text>}
        </Box>
        
        <Box>
          <Text bold>USAGE: </Text>
          <Text color="magenta">{usage.totalTokens.toLocaleString()}</Text>
          <Text dimColor> tokens</Text>
        </Box>
      </Box>

      <Text color="gray">{horizontalLine}</Text>

      {status === 'error' && error && (
        <Box borderStyle="single" borderColor="red" paddingX={1} marginBottom={1} height={4} flexDirection="column">
          <Text color="red" bold>CRITICAL ERROR:</Text>
          <Text color="red" wrap="truncate-end">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" height={14} flexGrow={1} marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">LIVE ACTIVITY LOG</Text>
        </Box>
        {messages.map((m, i) => (
          <MessageRow key={`${m.timestamp}-${i}`} m={m} width={terminalWidth} />
        ))}
        {messages.length === 0 && (
          <Box justifyContent="center" marginTop={2}>
            <Text dimColor italic>Iniciando sistemas neurais...</Text>
          </Box>
        )}
      </Box>

      <Text color="gray">{horizontalLine}</Text>

      {status !== 'running' && (
        <Box marginTop={1} justifyContent="center">
          <Text color="black" backgroundColor="white" bold> PRESS CTRL+C TO EXIT </Text>
        </Box>
      )}
    </Box>
  );
};
