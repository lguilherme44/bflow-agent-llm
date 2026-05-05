export type LocalRuntimeProfileId =
  | 'low-vram-8gb'
  | 'mlx-16gb-unified'
  | 'balanced-local'
  | 'cloud';

export interface LocalRuntimeProfile {
  id: LocalRuntimeProfileId;
  label: string;
  maxTurns: number;
  maxOutputTokens: number;
  maxInputChars: number;
  maxToolOutputChars: number;
  maxFileLines: number;
  maxListFiles: number;
  maxSearchMatches: number;
  maxRagResults: number;
  temperature: number;
}

export interface RuntimeProfileInput {
  provider?: string;
  model?: string;
  runtimeProfile?: string;
  maxTurns?: number;
  maxOutputTokens?: number;
  maxInputChars?: number;
  maxToolOutputChars?: number;
  maxFileLines?: number;
  maxListFiles?: number;
  maxSearchMatches?: number;
  maxRagResults?: number;
  temperature?: number;
}

export const LOCAL_RUNTIME_PROFILES: Record<LocalRuntimeProfileId, LocalRuntimeProfile> = {
  'low-vram-8gb': {
    id: 'low-vram-8gb',
    label: 'Local 8GB VRAM',
    maxTurns: 8,
    maxOutputTokens: 1024,
    maxInputChars: 26000,
    maxToolOutputChars: 2200,
    maxFileLines: 180,
    maxListFiles: 250,
    maxSearchMatches: 50,
    maxRagResults: 5,
    temperature: 0.1,
  },
  'mlx-16gb-unified': {
    id: 'mlx-16gb-unified',
    label: 'macOS MLX 16GB unified',
    maxTurns: 10,
    maxOutputTokens: 1280,
    maxInputChars: 34000,
    maxToolOutputChars: 2800,
    maxFileLines: 220,
    maxListFiles: 320,
    maxSearchMatches: 60,
    maxRagResults: 6,
    temperature: 0.1,
  },
  'balanced-local': {
    id: 'balanced-local',
    label: 'Balanced local',
    maxTurns: 12,
    maxOutputTokens: 1536,
    maxInputChars: 42000,
    maxToolOutputChars: 3500,
    maxFileLines: 260,
    maxListFiles: 400,
    maxSearchMatches: 80,
    maxRagResults: 8,
    temperature: 0.1,
  },
  cloud: {
    id: 'cloud',
    label: 'Cloud / high context',
    maxTurns: 18,
    maxOutputTokens: 2048,
    maxInputChars: 90000,
    maxToolOutputChars: 6000,
    maxFileLines: 420,
    maxListFiles: 500,
    maxSearchMatches: 100,
    maxRagResults: 10,
    temperature: 0.1,
  },
};

export function resolveLocalRuntimeProfile(input: RuntimeProfileInput = {}): LocalRuntimeProfile {
  const explicit = input.runtimeProfile as LocalRuntimeProfileId | undefined;
  const inferred = explicit && explicit in LOCAL_RUNTIME_PROFILES
    ? explicit
    : inferProfileId(input.provider, input.model);

  const base = LOCAL_RUNTIME_PROFILES[inferred];

  return {
    ...base,
    maxTurns: clampPositiveInt(input.maxTurns, base.maxTurns),
    maxOutputTokens: clampPositiveInt(input.maxOutputTokens, base.maxOutputTokens),
    maxInputChars: clampPositiveInt(input.maxInputChars, base.maxInputChars),
    maxToolOutputChars: clampPositiveInt(input.maxToolOutputChars, base.maxToolOutputChars),
    maxFileLines: clampPositiveInt(input.maxFileLines, base.maxFileLines),
    maxListFiles: clampPositiveInt(input.maxListFiles, base.maxListFiles),
    maxSearchMatches: clampPositiveInt(input.maxSearchMatches, base.maxSearchMatches),
    maxRagResults: clampPositiveInt(input.maxRagResults, base.maxRagResults),
    temperature: typeof input.temperature === 'number' ? input.temperature : base.temperature,
  };
}

function inferProfileId(provider?: string, model?: string): LocalRuntimeProfileId {
  const normalizedProvider = (provider ?? '').toLowerCase();
  const normalizedModel = (model ?? '').toLowerCase();

  if (['openai', 'anthropic', 'openrouter'].includes(normalizedProvider)) {
    return 'cloud';
  }

  if (['mlx', 'mlx-lm', 'omlx'].includes(normalizedProvider) || normalizedModel.includes('mlx')) {
    return 'mlx-16gb-unified';
  }

  if (
    normalizedModel.includes('7b') ||
    normalizedModel.includes('8b') ||
    normalizedModel.includes('qwen2.5-coder') ||
    normalizedModel.includes('deepseek-coder') ||
    normalizedModel.includes('codellama')
  ) {
    return 'low-vram-8gb';
  }

  return 'balanced-local';
}

function clampPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}
