import { useState, useEffect, useMemo, memo } from 'react';
import { Text, Box, useStdout, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { OrchestratorAgent, OrchestratorEvent } from '../agent/orchestrator.js';
import { RiskPolicyEngine } from '../utils/risk-engine.js';

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
    <Box width={Math.max(width, 0)} height={1}>
      <Text color="gray">{timestamp}</Text>
      <Text bold color={m.role === 'system' ? 'blue' : m.role === 'assistant' ? 'green' : 'white'}>
        {role}
      </Text>
      <Box width={Math.max(contentWidth, 1)}>
        <Text color="white" wrap="truncate-end">{cleanContent}</Text>
      </Box>
    </Box>
  );
});

MessageRow.displayName = 'MessageRow';

export const App = ({ orchestrator, initialTask }: AppProps) => {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    columns: stdout?.columns || 100,
    rows: stdout?.rows || 30
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        columns: stdout?.columns || 100,
        rows: stdout?.rows || 30
      });
    };

    stdout?.on('resize', handleResize);
    return () => {
      stdout?.off('resize', handleResize);
    };
  }, [stdout]);

  const terminalWidth = Math.max(dimensions.columns - 4, 20);
  // Cap height to 28 to avoid flickering in fullscreen terminals while remaining responsive for small ones
  const terminalHeight = Math.min(Math.max(dimensions.rows - 2, 15), 28);
  
  const { exit } = useApp();
  const [query, setQuery] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<'running' | 'completed' | 'error' | 'idle'>('idle');
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string>('Ready');
  const [usage, setUsage] = useState({ totalTokens: 0 });
  const [error, setError] = useState<string | null>(null);
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{
    toolCallId: string;
    toolName: string;
    args: any;
    risk?: any;
  } | null>(null);

  const riskEngine = useMemo(() => new RiskPolicyEngine(), []);

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

  const handleTaskSubmit = async (task: string) => {
    if (!task.trim() || isRunning) return;
    
    setIsRunning(true);
    setStatus('running');
    setQuery('');
    setFinalResult(null);
    setError(null);
    
    setMessages(prev => [...prev, {
      role: 'user',
      content: `> ${task}`,
      timestamp: new Date().toLocaleTimeString().split(' ')[0]
    }].slice(-12));

    try {
      await orchestrator.run(task);
    } catch (err: any) {
      setStatus('error');
      setError(err.message);
    } finally {
      setIsRunning(false);
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
        case 'human_approval_request':
          const evaluation = riskEngine.evaluateToolCall(event.toolName, event.args);
          setPendingApproval({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            risk: evaluation
          });
          break;
      }
    });

    if (initialTask) {
      handleTaskSubmit(initialTask);
    }
    
    return () => { isMounted = false; };
  }, [orchestrator, initialTask, formatContent, riskEngine]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (!pendingApproval) return;

    if (input === 'a' || input === 'A') {
      orchestrator.resolveApproval(true);
      setPendingApproval(null);
    } else if (input === 'r' || input === 'R') {
      orchestrator.resolveApproval(false);
      setPendingApproval(null);
    }
  });

  const horizontalLine = '─'.repeat(Math.max(terminalWidth, 0));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1} width={dimensions.columns} height={terminalHeight}>
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
          {status === 'running' && (
            <Box marginLeft={1}>
              <Text color="blue"><Spinner type="dots" /></Text>
            </Box>
          )}
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

      <Box flexDirection="column" flexGrow={1} marginTop={1} width={terminalWidth}>
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

      {status !== 'running' && !pendingApproval && (
        <Box marginTop={0} flexDirection="column">
          <Box marginBottom={1}>
            <Text color="cyan" bold>PRÓXIMA TAREFA: </Text>
            <TextInput 
              value={query} 
              onChange={setQuery} 
              onSubmit={handleTaskSubmit}
              placeholder="Digite sua próxima solicitação ou CTRL+C para sair..."
            />
          </Box>
          <Box justifyContent="center" height={1}>
            <Text color="black" backgroundColor="white" bold> CTRL+C PARA SAIR </Text>
          </Box>
        </Box>
      )}

      {pendingApproval && (
        <Box flexDirection="column" borderStyle="bold" borderColor="yellow" paddingX={1} marginY={1} width={terminalWidth}>
          <Box justifyContent="center" marginBottom={1}>
            <Text bold color="yellow" inverse> ⚠ APROVAÇÃO NECESSÁRIA ⚠ </Text>
          </Box>
          <Box>
            <Text bold>Ferramenta: </Text>
            <Text color="cyan">{pendingApproval.toolName}</Text>
          </Box>
          <Box>
            <Text bold>Argumentos: </Text>
            <Text dimColor>{JSON.stringify(pendingApproval.args).slice(0, 100)}...</Text>
          </Box>
          {pendingApproval.risk && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Risco: </Text>
              <Text color={pendingApproval.risk.level === 'high' ? 'red' : 'yellow'}>
                {pendingApproval.risk.level.toUpperCase()} (Score: {pendingApproval.risk.score})
              </Text>
              {pendingApproval.risk.reasons.map((r: string, i: number) => (
                <Text key={i} dimColor>• {r}</Text>
              ))}
            </Box>
          )}
          <Box marginTop={1} justifyContent="center">
            <Text backgroundColor="green" color="white" bold> [A]provar </Text>
            <Text>  </Text>
            <Text backgroundColor="red" color="white" bold> [R]ejeitar </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
