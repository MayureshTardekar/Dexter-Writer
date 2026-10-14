/**
 * Compatibility layer over the agent engine in `src/lib/agent/`.
 *
 * The transports, prompt builder and provider registry all moved into
 * `agent/` (see AI_AGENT_ROADMAP.md §3). This file keeps the old public
 * surface alive so existing importers need no changes:
 *   - App.tsx, ByokModal, ReviewAgentModal → PROVIDERS, resolveProvider
 *   - reviewAgent.ts, latexFixer.ts        → callLlm
 *   - aiGateway.test.ts                    → buildSystemPrompt, detectDocMacros
 *
 * New code should import from `./agent/...` directly.
 */

import { streamProvider } from './agent/providers';
import type { AgentMessage, ToolDef } from './agent/types';

export { PROVIDERS, resolveProvider } from './agent/providers/registry';
export type { ProviderId, ProviderInfo } from './agent/providers/registry';
export { buildSystemPrompt, detectDocMacros, numberLines, buildDocContext } from './agent/prompt';
export type { PromptOptions } from './agent/prompt';

export interface LlmToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export interface LlmTurn {
  text: string;
  toolCalls: LlmToolCall[];
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  text: string;
}

/** Extra (external MCP) tool definitions merged into the call. */
export interface ExtraToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * One-shot, non-agentic completion. Drains the streaming provider into a
 * single {@link LlmTurn}.
 *
 * Behaviour note: unlike the previous implementation, this no longer attaches
 * the virtual document tools automatically — only the `extra` tools you pass.
 * Every current caller (`reviewAgent`, `latexFixer`) wants plain text or JSON
 * back, and silently offering document tools made them liable to return a tool
 * call instead of an answer. For agentic work use `runAgent` from
 * `./agent/loop` instead.
 */
export async function callLlm(
  provider: string,
  opts: { apiKey: string; baseUrl: string; model: string },
  system: string,
  history: ChatHistoryItem[],
  userText: string,
  extra: ExtraToolDef[] = [],
): Promise<LlmTurn> {
  const messages: AgentMessage[] = [{ role: 'system', content: system }];
  for (const h of history) {
    if (h.role === 'assistant') messages.push({ role: 'assistant', content: h.text });
    else messages.push({ role: 'user', content: h.text });
  }
  messages.push({ role: 'user', content: userText });

  const tools: ToolDef[] = extra.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    kind: 'external' as const,
  }));

  let text = '';
  const toolCalls: LlmToolCall[] = [];
  for await (const chunk of streamProvider({
    provider,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    model: opts.model,
    messages,
    tools,
  })) {
    if (chunk.type === 'text') text += chunk.delta;
    else if (chunk.type === 'tool_call') {
      toolCalls.push({ name: chunk.call.name, args: chunk.call.args, id: chunk.call.id });
    }
  }
  return { text, toolCalls };
}
