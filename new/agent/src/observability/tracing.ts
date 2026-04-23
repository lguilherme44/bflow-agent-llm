import { Tracer, Span, SpanStatusCode, SpanKind, trace, context } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
  InMemorySpanExporter,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ToolResult, LLMTaskKind } from '../types/index.js';

const TRACER_NAME = 'agent-core';

export interface TracingConfig {
  /** Name for the service in trace backends. Default: 'agent' */
  serviceName: string;
  /** Enable console exporter (prints spans to stdout). Default: true */
  consoleExporter: boolean;
  /** OTLP HTTP endpoint for sending traces (e.g. Jaeger, Grafana Tempo). Optional. */
  otlpEndpoint?: string;
  /** Use in-memory exporter for tests. Default: false */
  inMemoryExporter: boolean;
}

const DEFAULT_CONFIG: TracingConfig = {
  serviceName: 'agent',
  consoleExporter: true,
  inMemoryExporter: false,
};

export class TracingService {
  private readonly provider: BasicTracerProvider;
  private readonly tracer: Tracer;
  private readonly memExporter: InMemorySpanExporter | null = null;

  constructor(config?: Partial<TracingConfig>) {
    const cfg: TracingConfig = { ...DEFAULT_CONFIG, ...config };

    // Use a local TracerProvider instead of the global one so that multiple
    // TracingService instances (e.g. across test cases) do not collide.
    this.provider = new BasicTracerProvider({
      resource: new Resource({ 'service.name': cfg.serviceName }),
    });

    if (cfg.inMemoryExporter) {
      this.memExporter = new InMemorySpanExporter();
      this.provider.addSpanProcessor(new SimpleSpanProcessor(this.memExporter));
    }

    if (cfg.consoleExporter && !cfg.inMemoryExporter) {
      this.provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    }

    if (cfg.otlpEndpoint) {
      this.provider.addSpanProcessor(
        new SimpleSpanProcessor(new OTLPTraceExporter({ url: cfg.otlpEndpoint }))
      );
    }

    this.tracer = this.provider.getTracer(TRACER_NAME);
  }

  // ── Tool Spans ──────────────────────────────────────────────

  startToolSpan(toolName: string, toolCallId: string): Span {
    return this.tracer.startSpan(`tool:${toolName}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'tool.name': toolName,
        'tool.call_id': toolCallId,
        'component': 'tool-executor',
      },
    });
  }

  recordToolResult(span: Span, result: ToolResult): void {
    span.setAttributes({
      'tool.success': result.success,
      'tool.attempts': result.attempts,
      'tool.duration_ms': result.durationMs,
      'tool.timed_out': result.timedOut,
      'tool.recoverable': result.recoverable,
    });

    if (result.errorCode) {
      span.setAttributes({ 'tool.error_code': result.errorCode });
    }

    if (result.error) {
      span.setAttributes({ 'tool.error_message': result.error });
    }

    if (result.rollback) {
      span.setAttributes({
        'tool.rollback.attempted': result.rollback.attempted,
        'tool.rollback.success': result.rollback.success,
      });
      if (result.rollback.error) {
        span.setAttributes({ 'tool.rollback.error': result.rollback.error });
      }
    }

    span.setStatus(
      result.success
        ? { code: SpanStatusCode.OK }
        : { code: SpanStatusCode.ERROR, message: result.error ?? 'Tool execution failed' }
    );

    span.end();
  }

  // ── Terminal Spans ──────────────────────────────────────────

  startTerminalSpan(command: string, cwd: string): Span {
    return this.tracer.startSpan(`exec:${command.split(' ')[0]}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'cmd.command': command,
        'cmd.cwd': cwd,
        'component': 'terminal-service',
      },
    });
  }

  recordTerminalResult(span: Span, result: { exitCode: number | null; durationMs: number; timedOut: boolean }): void {
    span.setAttributes({
      'cmd.exit_code': result.exitCode ?? -1,
      'cmd.duration_ms': result.durationMs,
      'cmd.timed_out': result.timedOut,
    });

    span.setStatus(
      result.exitCode === 0
        ? { code: SpanStatusCode.OK }
        : { code: SpanStatusCode.ERROR, message: `Command failed with exit code ${result.exitCode}` }
    );

    span.end();
  }

  // ── LLM Spans ───────────────────────────────────────────────

  startLLMSpan(provider: string, model: string, taskKind: LLMTaskKind = 'general'): Span {
    return this.tracer.startSpan(`llm:${provider}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'llm.provider': provider,
        'llm.model': model,
        'llm.task_kind': taskKind,
        'component': 'llm-router',
      },
    });
  }

  recordLLMUsage(
    span: Span,
    usage: { promptTokens: number; completionTokens: number; totalTokens: number },
    estimatedCostUsd?: number
  ): void {
    span.setAttributes({
      'llm.prompt_tokens': usage.promptTokens,
      'llm.completion_tokens': usage.completionTokens,
      'llm.total_tokens': usage.totalTokens,
    });

    if (estimatedCostUsd !== undefined) {
      span.setAttributes({ 'llm.estimated_cost_usd': estimatedCostUsd });
    }

    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  recordLLMError(span: Span, error: Error): void {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    span.end();
  }

  // ── Agent-level spans ───────────────────────────────────────

  startAgentSpan(task: string, agentId: string, parentSpan?: Span): Span {
    const options = {
      kind: SpanKind.INTERNAL,
      attributes: {
        'agent.id': agentId,
        'agent.task': task.slice(0, 200),
        'component': 'react-loop',
      },
    };

    if (parentSpan) {
      return this.tracer.startSpan(`agent:run`, options, this.getContext(parentSpan));
    }
    return this.tracer.startSpan(`agent:run`, options);
  }

  // ── Orchestrator spans ──────────────────────────────────────

  startOrchestratorSpan(task: string, agentId: string): Span {
    return this.tracer.startSpan(`orchestrator:run`, {
      kind: SpanKind.SERVER,
      attributes: {
        'agent.id': agentId,
        'agent.task': task.slice(0, 200),
        'component': 'orchestrator',
      },
    });
  }

  startPhaseSpan(phaseName: string, parentSpan?: Span): Span {
    const options = {
      kind: SpanKind.INTERNAL,
      attributes: {
        'orchestrator.phase': phaseName,
        'component': 'orchestrator',
      },
    };

    if (parentSpan) {
      return this.tracer.startSpan(`phase:${phaseName}`, options, this.getContext(parentSpan));
    }
    return this.tracer.startSpan(`phase:${phaseName}`, options);
  }

  startFeedbackLoopSpan(
    streamId: string,
    iteration: number,
    failureKind: string,
    parentSpan?: Span
  ): Span {
    const options = {
      kind: SpanKind.INTERNAL,
      attributes: {
        'feedback_loop.stream_id': streamId,
        'feedback_loop.iteration': iteration,
        'feedback_loop.failure_kind': failureKind,
        'component': 'feedback-loop',
      },
    };

    const spanName = `feedback-loop:${failureKind}:${iteration}`;
    if (parentSpan) {
      return this.tracer.startSpan(spanName, options, this.getContext(parentSpan));
    }
    return this.tracer.startSpan(spanName, options);
  }

  private getContext(span: Span) {
    return trace.setSpan(context.active(), span);
  }

  // ── Test helpers ────────────────────────────────────────────

  getFinishedSpans(): ReadableSpan[] {
    if (!this.memExporter) {
      throw new Error('getFinishedSpans() requires inMemoryExporter=true');
    }
    return this.memExporter.getFinishedSpans();
  }

  resetSpans(): void {
    this.memExporter?.reset();
  }

  // ── Lifecycle ───────────────────────────────────────────────

  async shutdown(): Promise<void> {
    await this.provider.shutdown();
  }
}

/** Create a TracingService configured for unit tests (in-memory, no console output). */
export function createTestTracing(): TracingService {
  return new TracingService({
    inMemoryExporter: true,
    consoleExporter: false,
    serviceName: 'agent-test',
  });
}
