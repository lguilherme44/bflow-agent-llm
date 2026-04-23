import { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
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

export const App = ({ orchestrator, initialTask }: AppProps) => {
  const [status, setStatus] = useState<'running' | 'completed' | 'error'>('running');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string>('Research');
  const [usage, setUsage] = useState({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  const [error, setError] = useState<string | null>(null);

  const formatContent = (content: string): string => {
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
  };

  useEffect(() => {
    let isMounted = true;

    orchestrator.setUpdateCallback((event: OrchestratorEvent) => {
      if (!isMounted) return;

      switch (event.type) {
        case 'phase_start':
          setCurrentPhase(event.phase);
          break;
        case 'message_added':
          setMessages(prev => [...prev, { 
            role: event.role, 
            content: formatContent(event.content),
            timestamp: new Date().toLocaleTimeString().split(' ')[0]
          }]);
          break;
        case 'usage_update':
          setUsage(event.usage);
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
          if (state.status === 'completed') {
            setStatus('completed');
          } else if (state.status === 'error') {
            setStatus('error');
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setStatus('error');
          setError(err.message);
        }
      }
    };

    runAgent();

    return () => {
      isMounted = false;
    };
  }, [orchestrator, initialTask]);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1} width={100}>
      <Box marginBottom={1} justifyContent="center">
        <Text bold color="cyan" inverse> AGENT OS INTERFACE </Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Tarefa: <Text italic color="white" bold={false}>{initialTask}</Text></Text>
      </Box>

      <Box marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Box>
          <Box marginRight={2}>
            <Text bold>STATUS: </Text>
            {status === 'running' && <Text color="yellow">RUNNING</Text>}
            {status === 'completed' && <Text color="green">COMPLETED</Text>}
            {status === 'error' && <Text color="red">ERROR</Text>}
          </Box>
          <Box>
            <Text bold>PHASE: </Text>
            <Text color="blue">{currentPhase.toUpperCase()}</Text>
            {status === 'running' && <Text color="blue"> <Spinner type="dots" /></Text>}
          </Box>
        </Box>
        
        <Box>
          <Text bold>USAGE: </Text>
          <Text color="magenta">{usage.totalTokens.toLocaleString()}</Text>
          <Text dimColor> tokens</Text>
        </Box>
      </Box>

      {status === 'error' && error && (
        <Box borderStyle="single" borderColor="red" paddingX={1} marginBottom={1}>
          <Text color="red" bold>CRITICAL ERROR: </Text>
          <Text color="red">{error}</Text>
        </Box>
      )}

      <Box flexDirection="column" borderStyle="classic" borderColor="cyan" paddingX={1} minHeight={12}>
        <Box marginBottom={1}>
          <Text bold color="cyan">LIVE ACTIVITY LOG</Text>
        </Box>
        {messages.slice(-10).map((m, i) => (
          <Box key={i} marginBottom={0}>
            <Text color="gray">{m.timestamp} </Text>
            <Text bold color={m.role === 'system' ? 'blue' : m.role === 'assistant' ? 'green' : 'white'}>
              [{m.role.toUpperCase()}]
            </Text>
            <Text color="white"> {m.content.slice(0, 85)}{m.content.length > 85 ? '...' : ''}</Text>
          </Box>
        ))}
        {messages.length === 0 && (
          <Box justifyContent="center" marginTop={2}>
            <Text dimColor italic>Iniciando sistemas neurais...</Text>
          </Box>
        )}
      </Box>

      {status !== 'running' && (
        <Box marginTop={1} justifyContent="center">
          <Text color="black" backgroundColor="white" bold> PRESS CTRL+C TO EXIT </Text>
        </Box>
      )}
    </Box>
  );
};
