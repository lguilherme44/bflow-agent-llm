/**
 * Simple utility to redact sensitive information from strings.
 * This is a placeholder for the original redaction logic.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;

  // Mask common API key patterns (basic version)
  return text
    .replace(/(sk-[a-zA-Z0-9]{20,})/g, 'sk-***')
    .replace(/(AIza[a-zA-Z0-9_\-]{35})/g, 'AIza***')
    .replace(/(ghp_[a-zA-Z0-9]{36,})/g, 'ghp_***')
    .replace(/(Bearer\s+)([a-zA-Z0-9._\-]{20,})/gi, '$1***');
}

export function redactMessages(messages: any[]): any[] {
  return messages.map(msg => ({
    ...msg,
    content: typeof msg.content === 'string' ? redactSecrets(msg.content) : msg.content
  }));
}
