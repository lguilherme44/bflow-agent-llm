import { JsonObject, JsonValue } from '../types/index.js';

export function toJsonValue(value: unknown, depth = 0): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ?? null,
    };
  }

  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return null;
  }

  if (depth > 20) {
    return '[Max serialization depth reached]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const output: JsonObject = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = toJsonValue(item, depth + 1);
    }
    return output;
  }

  return String(value);
}

export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
