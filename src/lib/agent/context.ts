import type { AgentMessage } from './types';

interface ContextMessage { role: 'user' | 'assistant'; text: string; sourceText?: string }
/** Keep complete user turns, prefer recent context, and explicitly report omissions. */
export function conversationContext(messages: ContextMessage[], maxChars = 48000): { history: AgentMessage[]; notice?: string } {
  let remaining = maxChars, omitted = 0;
  const kept = new Map<number, AgentMessage>();
  // User facts take precedence over assistant prose. Never silently cut a fact in half.
  for (const role of ['user', 'assistant'] as const) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]; if (m.role !== role) continue;
      const text = m.sourceText || m.text;
      if (!text.trim()) continue;
      if (text.length > remaining) { omitted++; continue; }
      remaining -= text.length; kept.set(i, { role: m.role, content: text });
    }
  }
  return { history: [...kept].sort(([a], [b]) => a - b).map(([, m]) => m), ...(omitted ? { notice: `${omitted} earlier message(s) do not fit the context budget. Put essential details in Saved facts/context before continuing.` } : {}) };
}
