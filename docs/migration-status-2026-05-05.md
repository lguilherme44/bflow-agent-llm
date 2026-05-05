# Migration status: Electron + OpenAI Agents SDK

Completed in this pass:

- Electron main process now configures writable cache/session paths on Windows before `app.whenReady()`.
- Agent runtime now has explicit profiles for `low-vram-8gb`, `mlx-16gb-unified`, `balanced-local` and `cloud`.
- The OpenAI Agents SDK path emits model usage, tool call and tool result events into Electron IPC.
- The dashboard no longer depends on `/api`; sessions, metrics, session detail and synthetic traces are served through the WebSocket on port `3030`.
- Settings now supports workspace selection, MLX provider defaults and editable runtime limits.
- MCP UI can connect and disconnect configured servers, and the manager exposes connection status and errors.
- Local model responses now retry once when the output is unreadable and fall back to a safe PT-BR message instead of leaking corrupted tokens into the chat.
- The coding agent prompt now treats questions and diagnostics as read-only unless the user explicitly asks for code changes.

Remaining hardening after this pass:

- macOS packaged-app smoke test.
- A real MLX run on macOS to tune defaults by model family.

Validation update:

- Windows `electron-builder --dir` passes and produces `electron-app/dist/win-unpacked/bflow-agent.exe`.
- Windows `electron-builder --win` passes and produces `electron-app/dist/bflow-agent-1.0.0-setup.exe`.
- Packaged Windows smoke test: `bflow-agent.exe` stayed alive for 8 seconds with isolated `BFLOW_AGENT_USER_DATA`.
- Native dependency rebuild now passes with `npmRebuild: true`: `scripts/patch-tree-sitter-cxx20.cjs` patches `tree-sitter@0.21.1` from C++17 to C++20 before `electron-builder` invokes `@electron/rebuild`.
- Rebuild was verified for `tree-sitter`, `tree-sitter-javascript`, `tree-sitter-json` and `tree-sitter-typescript`; packaging still unpacks `**/*.node` so native binaries load outside `app.asar`.
- Windows local-model run was exercised with LM Studio `google/gemma-4-e4b`, including prompt/completion token usage and completion latency in logs.
