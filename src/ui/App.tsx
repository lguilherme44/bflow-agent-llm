import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState,
} from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { OrchestratorAgent, OrchestratorEvent } from '../agent/orchestrator.js';
import { RiskEvaluation } from '../utils/risk-engine.js';
import { loadConfig, saveConfig, AgentConfig } from '../utils/config.js';

interface AppProps {
  orchestrator: OrchestratorAgent;
  initialTask?: string;
  initialState?: any; // AgentState
  modelName?: string;
  providerName?: string;
}

interface DisplayMessage {
  role: string;
  content: string;
  timestamp: string;
}

interface PendingApprovalState {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  risk?: RiskEvaluation;
}

type AppStatus = 'running' | 'completed' | 'error' | 'idle';

const PHASE_ORDER = ['Research', 'Planning', 'Execution', 'Finalized'] as const;
const PHASE_LABELS: Record<string, string> = {
  Ready: 'Pronto',
  Preparing: 'Preparando',
  Research: 'Pesquisa',
  Planning: 'Planejamento',
  Execution: 'Execucao',
  Approval: 'Aprovacao',
  Finalized: 'Entrega',
  Done: 'Concluido',
  Chat: 'Chat',
};

const STATUS_META: Record<
  AppStatus,
  { label: string; color: 'black' | 'white'; backgroundColor: 'green' | 'red' | 'yellow' | 'white' }
> = {
  idle: { label: 'PRONTO', color: 'black', backgroundColor: 'white' },
  running: { label: 'EM ANDAMENTO', color: 'black', backgroundColor: 'yellow' },
  completed: { label: 'CONCLUIDO', color: 'black', backgroundColor: 'green' },
  error: { label: 'ERRO', color: 'white', backgroundColor: 'red' },
};

const ROLE_META = {
  system: { label: 'SISTEMA', color: 'cyan' as const },
  assistant: { label: 'AGENTE', color: 'green' as const },
  user: { label: 'VOCE', color: 'yellow' as const },
  tool: { label: 'FERRAMENTA', color: 'magenta' as const },
};

const FINAL_RESULT_PREFIX = 'RESUMO FINAL:';
const MESSAGE_BUFFER_SIZE = 80;

function nowLabel() {
  return new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function compactWhitespace(value: string) {
  return value.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
}

function trimToLength(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(maxLength - 3, 0))}...`;
}

function formatContent(content: string) {
  const normalized = content.trim();

  try {
    if (normalized.startsWith('{')) {
      const parsed = JSON.parse(normalized) as { thought?: string; action?: string; summary?: string };

      if (parsed.summary) {
        return compactWhitespace(parsed.summary);
      }

      if (parsed.action) {
        return `Acao: ${compactWhitespace(parsed.action)}`;
      }

      if (parsed.thought) {
        return `Raciocinio: ${compactWhitespace(parsed.thought)}`;
      }
    }
  } catch {
    return compactWhitespace(content);
  }

  return compactWhitespace(content);
}

function summarizeArgs(args: Record<string, unknown>) {
  const serialized = JSON.stringify(args);
  if (!serialized) {
    return '{}';
  }

  return trimToLength(compactWhitespace(serialized), 180);
}

function appendMessage(previous: DisplayMessage[], next: DisplayMessage) {
  return [...previous, next].slice(-MESSAGE_BUFFER_SIZE);
}

function appendPhase(previous: string[], phase: string) {
  if (previous.includes(phase)) {
    return previous;
  }

  return [...previous, phase];
}

function horizontalRule(width: number) {
  return '-'.repeat(Math.max(width, 1));
}

const StatusBadge = memo(({ status }: { status: AppStatus }) => {
  const meta = STATUS_META[status];

  return (
    <Text bold color={meta.color} backgroundColor={meta.backgroundColor}>
      {' '}
      {meta.label}
      {' '}
    </Text>
  );
});

StatusBadge.displayName = 'StatusBadge';

const SectionTitle = memo(({ title, meta }: { title: string; meta?: string }) => (
  <Box justifyContent="space-between" marginBottom={1}>
    <Text bold color="cyan">
      {title}
    </Text>
    {meta ? <Text dimColor>{meta}</Text> : null}
  </Box>
));

SectionTitle.displayName = 'SectionTitle';

const PhaseTrack = memo(
  ({
    currentPhase,
    completedPhases,
    compact,
  }: {
    currentPhase: string;
    completedPhases: string[];
    compact: boolean;
  }) => {
    if (currentPhase === 'Chat' || completedPhases.includes('Chat')) {
      return (
        <Text color="blue" bold>
          {'[>] Chat direto ativo'}
        </Text>
      );
    }

    const renderItem = (phase: (typeof PHASE_ORDER)[number]) => {
      const isDone = completedPhases.includes(phase);
      const isActive = currentPhase === phase;
      const marker = isDone ? '[x]' : isActive ? '[>]' : '[ ]';
      const color = isDone ? 'green' : isActive ? 'yellow' : 'gray';

      return (
        <Text key={phase} color={color} bold={isDone || isActive}>
          {marker} {PHASE_LABELS[phase]}
        </Text>
      );
    };

    if (compact) {
      return (
        <Box flexDirection="column">
          {PHASE_ORDER.map((phase) => (
            <Box key={phase}>{renderItem(phase)}</Box>
          ))}
        </Box>
      );
    }

    return (
      <Box>
        {PHASE_ORDER.map((phase, index) => (
          <Box key={phase} marginRight={index === PHASE_ORDER.length - 1 ? 0 : 1}>
            {renderItem(phase)}
            {index < PHASE_ORDER.length - 1 ? <Text dimColor>{' -> '}</Text> : null}
          </Box>
        ))}
      </Box>
    );
  }
);

PhaseTrack.displayName = 'PhaseTrack';

const ActivityRow = memo(({ message, width }: { message: DisplayMessage; width: number }) => {
  const roleMeta = ROLE_META[message.role as keyof typeof ROLE_META] ?? ROLE_META.system;
  const timestampWidth = 6;
  const roleWidth = 12;
  const contentWidth = Math.max(width - timestampWidth - roleWidth - 2, 12);

  return (
    <Box width={Math.max(width, 0)} height={1}>
      <Box width={timestampWidth}>
        <Text color="gray">{message.timestamp}</Text>
      </Box>
      <Box width={roleWidth}>
        <Text color={roleMeta.color} bold>
          {roleMeta.label.padEnd(roleWidth - 1)}
        </Text>
      </Box>
      <Box width={contentWidth}>
        <Text wrap="truncate-end">{message.content}</Text>
      </Box>
    </Box>
  );
});

ActivityRow.displayName = 'ActivityRow';

export const App = ({ orchestrator, initialTask = '', initialState, modelName, providerName }: AppProps) => {
  const { stdout } = useStdout();
  const { exit } = useApp();

  const [dimensions, setDimensions] = useState({
    columns: stdout?.columns || 100,
    rows: stdout?.rows || 30,
  });
  const [query, setQuery] = useState('');
  const [activeTask, setActiveTask] = useState(initialState?.currentTask || initialTask.trim());
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<AppStatus>(
    initialState?.status === 'completed' ? 'completed' : 
    initialState?.status === 'error' ? 'error' : 
    'idle'
  );
  
  const [messages, setMessages] = useState<DisplayMessage[]>(() => {
    if (!initialState) return [];
    return initialState.messages
      .filter((m: any) => m.role !== 'system')
      .map((m: any) => ({
        role: m.role,
        content: formatContent(m.content),
        timestamp: m.timestamp?.split('T')[1]?.slice(0, 5) || nowLabel()
      }));
  });

  const [currentPhase, setCurrentPhase] = useState('Ready');
  const [completedPhases, setCompletedPhases] = useState<string[]>([]);
  const [usage, setUsage] = useState({ 
    totalTokens: initialState?.metadata?.totalTokensUsed || 0,
    latencyMs: 0,
    contextWindow: 0,
    reasoningTokens: 0
  });
  const [error, setError] = useState<string | null>(initialState?.metadata?.errorMessage || null);
  const [finalResult, setFinalResult] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApprovalState | null>(null);
  const [lastEventAt, setLastEventAt] = useState<string | null>(initialState ? nowLabel() : null);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);
  const [isAutonomous, setIsAutonomous] = useState(false);
  const [connectionStep, setConnectionStep] = useState<'provider' | 'model' | 'url' | null>(null);
  const [tempConfig, setTempConfig] = useState<Partial<AgentConfig>>({});

  const deferredMessages = useDeferredValue(messages);
  const deferredFinalResult = useDeferredValue(finalResult);

  const outerWidth = dimensions.columns || 100;
  const contentWidth = Math.max(outerWidth - 6, 24);
  const frameHeight = Math.max(Math.min((dimensions.rows || 30) - 1, 34), 20);
  const compactLayout = contentWidth < 90;
  const visibleMessageCount = Math.max(
    Math.min(
      frameHeight -
        (pendingApproval ? 17 : 14) -
        (deferredFinalResult ? (compactLayout ? 4 : 5) : 3) -
        (status === 'error' && error ? 3 : 0),
      12
    ),
    4
  );
  const visibleMessages = deferredMessages.slice(-visibleMessageCount);

  const syncDimensions = useEffectEvent(() => {
    setDimensions({
      columns: stdout?.columns || 100,
      rows: stdout?.rows || 30,
    });
  });

  useEffect(() => {
    stdout?.on('resize', syncDimensions);

    return () => {
      stdout?.off('resize', syncDimensions);
    };
  }, [stdout]);

  const submitTask = useEffectEvent(async (task: string, state?: any) => {
    const normalizedTask = compactWhitespace(task);
    if (!normalizedTask || isRunning) {
      return;
    }

    // Intercept commands
    if (normalizedTask.startsWith('/')) {
      const args = normalizedTask.split(' ');
      const cmd = args[0].toLowerCase();

      if (cmd === '/status') {
        const config = loadConfig();
        setMessages((prev) => appendMessage(prev, {
          role: 'system',
          content: `CONFIGURAÇÃO: Provider=${config.provider}, Modelo=${config.model || 'Padrão'}, URL=${config.baseUrl || 'Padrão'}`,
          timestamp: nowLabel()
        }));
        setQuery('');
        return;
      }

      if (cmd === '/connect') {
        setConnectionStep('provider');
        setQuery('');
        return;
      }

      if (cmd === '/help') {
        setMessages((prev) => appendMessage(prev, {
          role: 'system',
          content: 'COMANDOS: /connect (configurar LLM), /status (ver config), /help (ajuda)',
          timestamp: nowLabel()
        }));
        setQuery('');
        return;
      }
    }

    const timestamp = nowLabel();

    if (!state) {
      setActiveTask(normalizedTask);
      setStatus('running');
      setCompletedPhases([]);
      
      const isDefaultTask = normalizedTask === 'Oi! Como posso te ajudar hoje?';
      if (!isDefaultTask) {
        setMessages((previous) =>
          appendMessage(previous, {
            role: 'user',
            content: normalizedTask,
            timestamp,
          })
        );
      }
    } else {
      setIsRunning(true);
      setStatus('running');
    }

    setCurrentPhase('Preparing');
    setQuery('');
    setFinalResult(null);
    setError(null);
    setPendingApproval(null);
    setLastEventAt(timestamp);

    try {
      await orchestrator.run(normalizedTask, state);
    } catch (submissionError) {
      setStatus('error');
      setError(submissionError instanceof Error ? submissionError.message : String(submissionError));
    } finally {
      setIsRunning(false);
    }
  });

  const handleOrchestratorEvent = useEffectEvent((event: OrchestratorEvent) => {
    startTransition(() => {
      setLastEventAt(nowLabel());

      switch (event.type) {
        case 'phase_start':
          setCurrentPhase(event.phase);
          break;
        case 'phase_complete':
          setCompletedPhases((previous) => appendPhase(previous, event.phase));
          if (event.phase === 'Finalized') {
            setStatus('completed');
            setCurrentPhase('Done');
            setPendingApproval(null);
          }
          break;
        case 'message_added': {
          const formatted = formatContent(event.content);
          if (!formatted) {
            break;
          }

          if (formatted.startsWith(FINAL_RESULT_PREFIX)) {
            setFinalResult(formatted.replace(FINAL_RESULT_PREFIX, '').trim());
            break;
          }

          setMessages((previous) =>
            appendMessage(previous, {
              role: event.role,
              content: formatted,
              timestamp: nowLabel(),
            })
          );
          
          if (event.usage || event.latencyMs) {
            setUsage(prev => ({
              ...prev,
              totalTokens: event.usage?.totalTokens ?? prev.totalTokens,
              latencyMs: event.latencyMs ?? prev.latencyMs,
              contextWindow: event.contextWindow ?? prev.contextWindow,
              reasoningTokens: event.reasoningTokens ?? prev.reasoningTokens
            }));
          }
          break;
        }
        case 'usage_update':
          setUsage(prev => ({ ...prev, totalTokens: event.usage.totalTokens }));
          break;
        case 'error':
          setStatus('error');
          setError(event.message);
          setPendingApproval(null);
          break;
        case 'human_approval_request':
          setCurrentPhase('Approval');
          setPendingApproval({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args as Record<string, unknown>,
            risk: event.riskEvaluation as RiskEvaluation | undefined,
          });
          break;
      }
    });
  });

  useEffect(() => {
    orchestrator.setUpdateCallback(handleOrchestratorEvent);
  }, [orchestrator]);

  useEffect(() => {
    if (hasAutoStarted) {
      return;
    }

    setHasAutoStarted(true);
    if (initialState) {
      void submitTask(initialState.currentTask || initialTask, initialState);
    } else if (initialTask.trim()) {
      void submitTask(initialTask);
    }
  }, [hasAutoStarted, initialTask, initialState]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (input === 'g' || input === 'G') {
      const nextMode = !isAutonomous;
      setIsAutonomous(nextMode);
      orchestrator.setAutoApprove(nextMode);
      return;
    }

    if (!pendingApproval) {
      return;
    }

    if (input === 'a' || input === 'A') {
      orchestrator.resolveApproval(true);
      setPendingApproval(null);
    }

    if (input === 'r' || input === 'R') {
      orchestrator.resolveApproval(false);
      setPendingApproval(null);
    }
  });

  const phaseLabel = PHASE_LABELS[currentPhase] ?? currentPhase;
  const summaryText = deferredFinalResult
    ? trimToLength(compactWhitespace(deferredFinalResult), compactLayout ? 220 : 360)
    : status === 'error' && error
      ? trimToLength(compactWhitespace(error), compactLayout ? 180 : 240)
      : isRunning
        ? 'O agente esta executando a tarefa e atualizando o painel em tempo real.'
        : activeTask
          ? 'Tarefa pronta para nova iteracao. Voce pode enviar outra solicitacao abaixo.'
          : 'Painel pronto. Digite uma tarefa para iniciar a execucao do agente.';
  const summaryTone: 'red' | 'green' | 'blue' = status === 'error' ? 'red' : deferredFinalResult ? 'green' : 'blue';
  const summaryTitle = deferredFinalResult ? 'Resumo final' : status === 'error' ? 'Falha de execucao' : 'Visao geral';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={status === 'error' ? 'red' : 'cyan'}
      paddingX={2}
      paddingY={1}
      width={outerWidth}
      height={frameHeight}
    >
      <Box
        flexDirection={compactLayout ? 'column' : 'row'}
        justifyContent="space-between"
        marginBottom={1}
      >
        <Box flexDirection="column">
          <Box alignItems="center">
            <Text bold color="cyan">
              Agent Control Center
            </Text>
            {modelName && (
              <Box marginLeft={2}>
                <Text dimColor>[</Text>
                <Text color="green" bold>{providerName?.toUpperCase()}</Text>
                <Text dimColor>:</Text>
                <Text color="yellow">{modelName}</Text>
                <Text dimColor>]</Text>
              </Box>
            )}
          </Box>
          <Text dimColor>Interface operacional para execucao assistida de tarefas.</Text>
        </Box>
        <Box
          flexDirection="column"
          alignItems={compactLayout ? 'flex-start' : 'flex-end'}
          marginTop={compactLayout ? 1 : 0}
        >
          <Box marginBottom={1}>
            <StatusBadge status={status} />
            {isAutonomous && (
              <Box marginLeft={1}>
                <Text color="white" backgroundColor="red" bold> AUTONOMO </Text>
              </Box>
            )}
          </Box>
          <Text dimColor>{lastEventAt ? `Atualizado as ${lastEventAt}` : 'Sessao pronta'}</Text>
        </Box>
      </Box>

      <Text color="gray">{horizontalRule(contentWidth)}</Text>

      <Box marginTop={1} flexDirection="column">
        <SectionTitle title="Tarefa ativa" meta={activeTask ? undefined : 'Aguardando entrada'} />
        <Text wrap="truncate-end">{activeTask || 'Nenhuma tarefa em andamento no momento.'}</Text>
      </Box>

      <Box
        marginTop={1}
        flexDirection={compactLayout ? 'column' : 'row'}
        justifyContent="space-between"
      >
        <Box flexDirection="column" marginRight={compactLayout ? 0 : 2}>
          <Text bold>
            Fase atual:{' '}
            <Text color="yellow">{phaseLabel}</Text>
            {status === 'running' ? (
              <Text color="yellow">
                {' '}
                <Spinner type="dots" />
              </Text>
            ) : null}
          </Text>
          <Text dimColor>Fluxo principal do agente durante esta execucao.</Text>
        </Box>

        <Box flexDirection="column" alignItems={compactLayout ? 'flex-start' : 'flex-end'}>
          <Text bold>
            Uso: <Text color="magenta">{usage.totalTokens.toLocaleString('pt-BR')}</Text>
            {usage.contextWindow > 0 && (
              <Text> / <Text color="cyan">{usage.contextWindow.toLocaleString('pt-BR')}</Text></Text>
            )}
            <Text dimColor> tokens</Text>
          </Text>
          <Box>
            {usage.latencyMs > 0 && (
              <Box marginRight={1}>
                <Text dimColor>
                  Lat: <Text color="yellow">{(usage.latencyMs / 1000).toFixed(1)}s</Text>
                </Text>
              </Box>
            )}
            {usage.reasoningTokens > 0 && (
              <Text dimColor>
                Raciocinio: <Text color="blue">{usage.reasoningTokens}</Text>
              </Text>
            )}
          </Box>
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <SectionTitle title="Progresso" />
        <PhaseTrack currentPhase={currentPhase} completedPhases={completedPhases} compact={compactLayout} />
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={summaryTone}
        paddingX={1}
        marginTop={1}
        width={contentWidth}
      >
        <SectionTitle title={summaryTitle} />
        <Text wrap="wrap">{summaryText}</Text>
      </Box>

      {status === 'error' && error ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="red">
            Erro atual
          </Text>
          <Text color="red" wrap="truncate-end">
            {compactWhitespace(error)}
          </Text>
        </Box>
      ) : null}

      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        <SectionTitle
          title="Atividade"
          meta={`${visibleMessages.length} de ${deferredMessages.length} eventos visiveis`}
        />
        {visibleMessages.length > 0 ? (
          visibleMessages.map((message, index) => (
            <ActivityRow
              key={`${message.timestamp}-${message.role}-${index}`}
              message={message}
              width={contentWidth}
            />
          ))
        ) : (
          <Box justifyContent="center" marginTop={1}>
            <Text dimColor italic>
              O painel exibira aqui o historico operacional da tarefa.
            </Text>
          </Box>
        )}
      </Box>

      <Text color="gray">{horizontalRule(contentWidth)}</Text>

      {connectionStep ? (
        <Box
          flexDirection="column"
          borderStyle="double"
          borderColor="yellow"
          paddingX={1}
          marginTop={1}
          width={contentWidth}
        >
          <SectionTitle 
            title={
              connectionStep === 'provider' ? 'Selecionar Provider (1-5)' : 
              connectionStep === 'model' ? 'Definir Modelo' : 'Definir Base URL'
            } 
          />
          {connectionStep === 'provider' && (
            <Box flexDirection="column" marginBottom={1}>
              <Text>1. OpenAI  2. Anthropic  3. Ollama  4. LM Studio  5. OpenRouter</Text>
              <Text dimColor>Digite o numero e pressione Enter</Text>
            </Box>
          )}
          <Box>
            <Text bold color="yellow">{connectionStep === 'provider' ? 'Opção: ' : connectionStep === 'model' ? 'Modelo: ' : 'URL: '}</Text>
            <TextInput
              value={query}
              onChange={setQuery}
              onSubmit={(value) => {
                if (connectionStep === 'provider') {
                  const providers: AgentConfig['provider'][] = ['openai', 'anthropic', 'ollama', 'lmstudio', 'openrouter'];
                  const p = providers[parseInt(value) - 1];
                  if (p) {
                    setTempConfig({ provider: p });
                    setConnectionStep('model');
                  }
                } else if (connectionStep === 'model') {
                  if (value) setTempConfig(prev => ({ ...prev, model: value }));
                  setConnectionStep('url');
                } else if (connectionStep === 'url') {
                  const finalConfig = { ...tempConfig };
                  if (value) finalConfig.baseUrl = value;
                  saveConfig(finalConfig);
                  setConnectionStep(null);
                  setMessages(prev => appendMessage(prev, {
                    role: 'system',
                    content: '✅ Configuração salva! Reinicie para aplicar as mudanças.',
                    timestamp: nowLabel()
                  }));
                }
                setQuery('');
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Pressione Esc ou envie vazio para cancelar (não implementado, use /help se perder)</Text>
          </Box>
        </Box>
      ) : pendingApproval ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
          marginTop={1}
          width={contentWidth}
        >
          <SectionTitle title="Aprovacao humana necessaria" meta={pendingApproval.toolCallId} />
          <Box marginBottom={1}>
            <Text>
              <Text bold>Ferramenta:</Text> <Text color="cyan">{pendingApproval.toolName}</Text>
            </Text>
          </Box>
          <Box marginBottom={1}>
            <Text wrap="wrap">
              <Text bold>Argumentos:</Text> {summarizeArgs(pendingApproval.args)}
            </Text>
          </Box>
          {pendingApproval.risk ? (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold>
                Risco:{' '}
                <Text
                  color={
                    pendingApproval.risk.level === 'high' || pendingApproval.risk.level === 'blocked'
                      ? 'red'
                      : 'yellow'
                  }
                >
                  {pendingApproval.risk.level.toUpperCase()} ({pendingApproval.risk.score})
                </Text>
              </Text>
              {pendingApproval.risk.reasons.length > 0 ? (
                pendingApproval.risk.reasons.slice(0, 3).map((reason, index) => (
                  <Text key={`${reason}-${index}`} dimColor wrap="truncate-end">
                    - {reason}
                  </Text>
                ))
              ) : (
                <Text dimColor>Nenhum detalhe adicional de risco foi informado.</Text>
              )}
            </Box>
          ) : null}
          <Box>
            <Text color="black" backgroundColor="green" bold>
              {' '}
              [A] Aprovar
              {' '}
            </Text>
            <Text>  </Text>
            <Text color="white" backgroundColor="red" bold>
              {' '}
              [R] Rejeitar
              {' '}
            </Text>
          </Box>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color="cyan">
              Nova tarefa:{' '}
            </Text>
            <TextInput
              value={query}
              onChange={setQuery}
              onSubmit={(value) => {
                void submitTask(value);
              }}
              placeholder="Descreva a proxima tarefa e pressione Enter"
            />
          </Box>
          <Text dimColor>Enter executa a tarefa atual. [G] Alternar Autonomo. Ctrl+C encerra a interface.</Text>
        </Box>
      )}
    </Box>
  );
};
