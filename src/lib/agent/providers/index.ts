import type { AgentMessage, ProviderCallOptions, ProviderStream, ToolDef } from '../types';
import { resolveConnection } from './registry';
import { streamOpenAiCompatible } from './openaiCompat';
import { streamGemini } from './gemini';
import { streamAnthropic } from './anthropic';

export * from './registry';

export interface ProviderRequest {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: AgentMessage[];
  tools: ToolDef[];
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** Set false for short one-shot calls (completion, inline edit). */
  stream?: boolean;
}

/**
 * Pick the right transport for a provider id and stream the completion.
 * Blank model/baseUrl fall back to the provider's defaults.
 */
export function streamProvider(req: ProviderRequest): ProviderStream {
  const conn = resolveConnection(req.provider, { apiKey: req.apiKey, baseUrl: req.baseUrl, model: req.model });
  const opts: ProviderCallOptions = {
    apiKey: conn.apiKey,
    baseUrl: conn.baseUrl,
    model: conn.model,
    messages: req.messages,
    tools: req.tools,
    signal: req.signal,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    stream: req.stream,
  };
  if (conn.kind === 'openai') return streamOpenAiCompatible(opts);
  if (conn.kind === 'anthropic') return streamAnthropic(opts);
  return streamGemini(opts);
}

/**
 * Drain a provider stream into plain text, ignoring tool calls.
 * Used by the one-shot callers (completion, inline edit, audit, latex fixer).
 */
export async function collectText(req: ProviderRequest): Promise<string> {
  let out = '';
  for await (const chunk of streamProvider(req)) {
    if (chunk.type === 'text') out += chunk.delta;
  }
  return out;
}
