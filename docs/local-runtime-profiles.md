# Local runtime profiles

This project is tuned to run coding agents against OpenAI-compatible local
servers, including LM Studio, Ollama, oMLX and `mlx-lm server`.

## Profiles

| Profile | Target | Defaults |
| --- | --- | --- |
| `low-vram-8gb` | GPUs with up to 8GB VRAM | 8 turns, 1024 output tokens, 2200 chars per tool result, 180 file lines |
| `mlx-16gb-unified` | macOS Apple Silicon with 16GB unified memory | 10 turns, 1280 output tokens, 2800 chars per tool result, 220 file lines |
| `balanced-local` | Local models with more headroom | 12 turns, 1536 output tokens |
| `cloud` | Hosted models or high-context servers | 18 turns, 2048 output tokens |

The Electron settings panel exposes these values so a developer can tune them
per machine. The core also infers a profile from provider/model names when no
profile is explicitly selected.

## MLX endpoints

The default MLX provider assumes an OpenAI-compatible server:

- `mlx`: `http://localhost:8080/v1`
- `omlx`: `http://localhost:8000/v1`

Both are treated as local zero-cost providers in dashboard metrics.

## Windows cache fix

On Windows, the Electron main process sets writable Chromium paths before app
startup:

- `userData`: `%LOCALAPPDATA%\bflow-agent`
- `sessionData`: `%LOCALAPPDATA%\bflow-agent\session`
- `disk-cache-dir`: `%LOCALAPPDATA%\bflow-agent\cache`

This avoids Chromium cache permission failures such as
`Unable to move the cache: Acesso negado` and related GPU cache creation
errors.
