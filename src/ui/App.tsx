/**
 * Agent Control Center — TUI limpa e organizada.
 *
 * Design principles:
 * - Hierarquia visual clara (header → status → phases → activity → input)
 * - Cores consistentes e suaves
 * - Informação densa mas escaneável
 * - Sem poluição visual
 */
import { memo, startTransition, useEffect, useEffectEvent, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import type { OrchestratorAgent, OrchestratorEvent } from '../agent/orchestrator.js';
import type { RiskEvaluation } from '../utils/risk-engine.js';

// ── Types ─────────────────────────────────────────────────────

interface AppProps {
  orchestrator: OrchestratorAgent;
  initialTask?: string;
  initialState?: any;
  modelName?: string;
  providerName?: string;
}

interface DisplayMessage {
  role: string;
  content: string;
  timestamp: string;
  tokens?: number;
}

type AppStatus = 'idle' | 'running' | 'completed' | 'error';

const PHASES = ['Research', 'Planning', 'Execution'] as const;

// ── Helpers ───────────────────────────────────────────────────

const now = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hr = (w: number) => '─'.repeat(Math.max(w, 1));
const clip = (s: string, n: number) => s.length > n ? s.slice(0, n - 2) + '…' : s;
const compact = (s: string) => s.replace(/\s+/g, ' ').trim();
const fmt = (n: number) => n.toLocaleString('pt-BR');

function fmtContent(c: string): string {
  const t = c.trim();
  try {
    if (t.startsWith('{')) {
      const p = JSON.parse(t);
      return compact(p.summary || p.thought || p.action || t);
    }
  } catch {}
  return compact(t);
}

// ── Components ────────────────────────────────────────────────

const PhaseBar = memo(({ phase, completed }: { phase: string; completed: string[] }) => (
  <Box>
    {PHASES.map((p, i) => {
      const done = completed.includes(p);
      const active = phase === p;
      return (
        <Box key={p}>
          <Text color={done ? 'green' : active ? 'yellow' : 'gray'} bold={active}>
            {done ? '●' : active ? '◉' : '○'} {p}
          </Text>
          {i < PHASES.length - 1 && <Text color="gray"> ─ </Text>}
        </Box>
      );
    })}
  </Box>
));

const TokenBar = memo(({ tokens, latency }: { tokens: number; latency: number }) => (
  <Box>
    <Text color="magenta">⬡ {fmt(tokens)} tokens</Text>
    {latency > 0 && <Text color="gray"> · {(latency / 1000).toFixed(1)}s</Text>}
  </Box>
));

export const App = ({ orchestrator, initialTask = '', initialState, modelName, providerName }: AppProps) => {
  const { stdout } = useStdout();
  const { exit } = useApp();
  const W = stdout?.columns || 100;

  const [status, setStatus] = useState<AppStatus>('idle');
  const [task, setTask] = useState(initialTask || '');
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('Ready');
  const [completed, setCompleted] = useState<string[]>([]);
  const [tokens, setTokens] = useState(0);
  const [latency, setLatency] = useState(0);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [showInput, setShowInput] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{ tool: string; args: string; risk?: RiskEvaluation } | null>(null);

  const handleEvent = useEffectEvent((e: OrchestratorEvent) => {
    startTransition(() => {
      switch (e.type) {
        case 'phase_start': setPhase(e.phase); break;
        case 'phase_complete':
          setCompleted(p => p.includes(e.phase) ? p : [...p, e.phase]);
          if (e.phase === 'Finalized') { setStatus('completed'); setShowInput(true); }
          break;
        case 'message_added':
          if (e.role === 'assistant') {
            const c = fmtContent(e.content);
            if (c) setMessages(p => [...p, { role: '🤖', content: c, timestamp: now(), tokens: e.usage?.totalTokens }].slice(-50));
            if (e.usage) { setTokens(e.usage.totalTokens); setLatency(e.latencyMs || 0); }
          } else if (e.role === 'system' && e.content?.includes('RESUMO FINAL')) {
            setResult(clip(e.content.replace('RESUMO FINAL:', '').trim(), 300));
          }
          break;
        case 'usage_update': setTokens(e.usage.totalTokens); break;
        case 'error': setStatus('error'); setError(e.message); setShowInput(true); break;
        case 'human_approval_request':
          setPendingApproval({ tool: e.toolName, args: JSON.stringify(e.args), risk: e.riskEvaluation as any });
          break;
      }
    });
  });

  useEffect(() => { orchestrator.setUpdateCallback(handleEvent); }, [orchestrator]);

  // Auto-start
  useEffect(() => {
    if (initialState || !initialTask?.trim()) return;
    const t = initialTask;
    setTask(t);
    setStatus('running');
    setRunning(true);
    setShowInput(false);
    orchestrator.run(t).then(() => { setRunning(false); setShowInput(true); });
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') exit();
    if (input === 'g') { const n = !autoApprove; setAutoApprove(n); orchestrator.setAutoApprove(n); }
    if (pendingApproval) {
      if (input === 'a') { orchestrator.resolveApproval(true); setPendingApproval(null); }
      if (input === 'r') { orchestrator.resolveApproval(false); setPendingApproval(null); }
    }
  });

  // ── Render ──────────────────────────────────────────────────

  return (
    <Box flexDirection="column" padding={1} width={W}>
      {/* HEADER */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text bold color="cyan">bflow</Text>
          <Text dimColor> agent · </Text>
          <Text color={status === 'error' ? 'red' : status === 'completed' ? 'green' : 'yellow'}>
            {status === 'idle' ? 'pronto' : status === 'running' ? 'executando' : status === 'completed' ? 'concluído' : 'erro'}
          </Text>
        </Box>
        <Box>
          <Text dimColor>{providerName?.toUpperCase()}:{modelName}</Text>
          <Text dimColor> · {now()}</Text>
        </Box>
      </Box>

      <Text color="gray">{hr(W - 4)}</Text>

      {/* TASK + STATUS */}
      <Box marginY={1} justifyContent="space-between">
        <Box flexDirection="column">
          <Text bold>Tarefa</Text>
          <Text>{clip(task || 'Nenhuma', W - 40)}</Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text bold>Tokens</Text>
          <TokenBar tokens={tokens} latency={latency} />
        </Box>
      </Box>

      {/* PHASES */}
      <Box marginY={1} flexDirection="column">
        <Text bold>Pipeline</Text>
        <Box marginTop={1}>
          <PhaseBar phase={phase} completed={completed} />
          {running && <Box marginLeft={1}><Spinner type="dots" /></Box>}
        </Box>
      </Box>

      <Text color="gray">{hr(W - 4)}</Text>

      {/* RESULT / ERROR */}
      {(result || error) && (
        <Box flexDirection="column" marginY={1} borderStyle="round" borderColor={error ? 'red' : 'green'} padding={1}>
          <Text bold color={error ? 'red' : 'green'}>{error ? 'Erro' : 'Resultado'}</Text>
          <Text>{clip(error || result, W - 10)}</Text>
        </Box>
      )}

      {/* ACTIVITY FEED */}
      <Box flexDirection="column" marginY={1} flexGrow={1}>
        <Text bold>Atividade <Text dimColor>({messages.length} eventos)</Text></Text>
        <Box flexDirection="column" marginTop={1} height={Math.min(12, messages.length || 3)}>
          {messages.slice(-10).map((m, i) => (
            <Box key={i}>
              <Text color="gray" dimColor>{m.timestamp} </Text>
              <Text color="cyan">{m.role} </Text>
              <Text>{clip(m.content, W - 30)}</Text>
              {m.tokens && <Text color="magenta" dimColor> ({fmt(m.tokens)}</Text>}
              {m.tokens && <Text color="magenta" dimColor>t)</Text>}
            </Box>
          ))}
          {messages.length === 0 && <Text dimColor italic>  Aguardando atividade do agente…</Text>}
        </Box>
      </Box>

      <Text color="gray">{hr(W - 4)}</Text>

      {/* APPROVAL PROMPT */}
      {pendingApproval ? (
        <Box flexDirection="column" marginY={1} borderStyle="round" borderColor="yellow" padding={1}>
          <Text bold color="yellow">Aprovação necessária</Text>
          <Text>Ferramenta: <Text color="cyan">{pendingApproval.tool}</Text></Text>
          <Text dimColor>{clip(pendingApproval.args, W - 20)}</Text>
          <Box marginTop={1}>
            <Text backgroundColor="green" color="black" bold> A - Aprovar </Text>
            <Text> </Text>
            <Text backgroundColor="red" color="white" bold> R - Rejeitar </Text>
          </Box>
        </Box>
      ) : showInput ? (
        <Box marginY={1}>
          <Box marginRight={1}><Text bold color="cyan">▸</Text></Box>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={v => {
              const t = compact(v);
              if (!t) return;
              setTask(t); setInput(''); setStatus('running'); setRunning(true); setShowInput(false);
              setMessages([]); setResult(''); setError(''); setCompleted([]); setPhase('Research');
              orchestrator.run(t).then(() => { setRunning(false); setShowInput(true); });
            }}
            placeholder="Descreva a tarefa e pressione Enter…"
          />
        </Box>
      ) : null}

      {/* FOOTER */}
      <Box justifyContent="space-between">
        <Text dimColor>Enter: executar · G: alternar autônomo · Ctrl+C: sair</Text>
        {autoApprove && <Text backgroundColor="red" color="white" bold> AUTO </Text>}
      </Box>
    </Box>
  );
};
