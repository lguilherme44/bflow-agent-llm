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

- Real packaged-app smoke test on Windows and macOS.
- Native dependency rebuild verification for Electron packaging (`tree-sitter`, `@lancedb/lancedb`).
- A real local-model run against LM Studio/Ollama/MLX to tune defaults by model family.
