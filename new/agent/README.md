# Agent Core

Checkpointable ReAct agent core with durable state, HITL, robust tool execution and AST-first code tools.

## Commands

```bash
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run start
```

## What Is Included

- Explicit event-based agent state machine.
- JSON-serializable `AgentState` with context, events, tool history and pending human approvals.
- In-memory and file checkpoint storage with atomic writes and resume recovery.
- ReAct loop split into observe, think, act and verify steps.
- LLM response parser for single tool calls, multiple tool calls and final structured responses.
- Tool schema builder with LLM-oriented descriptions, examples, failure modes and recoverable errors.
- Tool executor with timeout, retry/backoff, validation errors, rollback hooks and actionable `ToolResult`.
- Context manager with structured summaries, file relevance, decisions and constraints.
- Tree-sitter parser service for TS, TSX, JS, JSX and JSON.
- ast-grep structural search/edit-plan service.
- TypeScript Language Service helpers for definitions, references, rename and organize imports.
- Development tools for file reads, AST plans, edit-plan apply/revert, search and guarded terminal commands.

## Demo

```bash
npm.cmd run build
npm.cmd run start
```

The demo uses `MockLLMAdapter`, reads `src/index.ts`, calls `complete_task`, and writes a checkpoint under `.agent-checkpoints`.
