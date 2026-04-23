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
  const role = `[${m.role.toUpperCase()}]`.padEnd(12);
  const contentWidth = width - timestamp.length - role.length - 2;

  return (
    <Box width={width} height={1}>
      <Text color="gray">{timestamp}</Text>
      <Text bold color={m.role === 'system' ? 'blue' : m.role === 'assistant' ? 'green' : 'white'}>
        {role}
      </Text>
      <Box width={contentWidth}>
        <Text color="white" wrap="truncate-end">{cleanContent}</Text>
      </Box>
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
  const [finalResult, setFinalResult] = useState<string | null>(null);

  const formatContent = useMemo(() => (content: string): string => {
    try {
      if (content.trim().startsWith('{')) {
        const parsed = JSON.parse(content);
        if (parsed.thought) return `Pensando: ${parsed.thought}`;
        if (parsed.action) return `Ação: ${parsed.action}`;
        if (parsed.summary) return parsed.summary;
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
            setCurrentPhase('Done');
          }
          break;
        case 'message_added':
          const now = new Date().toLocaleTimeString().split(' ')[0];
          const formatted = formatContent(event.content);
          
          if (formatted.startsWith('RESUMO FINAL: ')) {
            setFinalResult(formatted.replace('RESUMO FINAL: ', ''));
          }

          setMessages(prev => {
            const next = [...prev, { 
              role: event.role, 
              content: formatted,
              timestamp: now
            }];
            return next.slice(-12);
          });
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
        await orchestrator.run(initialTask);
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
      <Box marginBottom={1} justifyContent="center" height={1}>
        <Text bold color="cyan" inverse> AGENT OS v1.0 </Text>
      </Box>

      <Box marginBottom={1} width={terminalWidth} height={1}>
        <Text bold>Tarefa: </Text>
        <Text italic color="white" wrap="truncate-end">{initialTask}</Text>
      </Box>

      <Box marginBottom={1} justifyContent="space-between" height={1}>
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

      {finalResult && (
        <Box flexDirection="column" borderStyle="double" borderColor="green" paddingX={1} marginY={1} width={terminalWidth} maxHeight={10}>
          <Box marginBottom={0}>
            <Text bold color="green">ASSISTANT RESPONSE</Text>
          </Box>
          <Text color="white" wrap="wrap">{finalResult}</Text>
        </Box>
      )}

      {status === 'error' && error && (
        <Box borderStyle="single" borderColor="red" paddingX={1} marginBottom={1} height={4} flexDirection="column" width={terminalWidth}>
          <Text color="red" bold>CRITICAL ERROR:</Text>
          <Text color="red" wrap="wrap">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1} marginTop={1} width={terminalWidth} height={finalResult ? 4 : 14}>
        <Box marginBottom={1}>
          <Text bold color="cyan">ACTIVITY LOG</Text>
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
        <Box marginTop={0} justifyContent="center" height={1}>
          <Text color="black" backgroundColor="white" bold> PRESS CTRL+C TO EXIT </Text>
        </Box>
      )}
    </Box>
  );
};
