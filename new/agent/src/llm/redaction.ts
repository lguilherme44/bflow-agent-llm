import { AgentMessage } from '../types';

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*["']?[^"'\s]+/gi, '$1=[REDACTED]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_API_KEY]'],
  [/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, '[REDACTED_SECRET]'],
];

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

export function redactMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => ({
    ...message,
    content: redactSecrets(message.content),
  }));
}
