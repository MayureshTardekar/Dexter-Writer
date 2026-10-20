import type { AgentMessage, ProviderCallOptions, ProviderStream, ToolCall, ToolDef } from '../types';
import { errorBody, readSseLines, tryParseJson } from '../sse';

/**
 * OpenAI-compatible transport: OpenAI, Groq, OpenRouter, NVIDIA NIM, Ollama
 * and user-registered `custom:*` endpoints.
 *
 * See AI_AGENT_ROADMAP.md §5.1. The two things that matter:
 *  - A `tool` message must carry `tool_call_id` and directly follow the
 *    assistant message whose `tool_calls` contains that id.
 *  - Streamed tool calls arrive FRAGMENTED and index-keyed; `arguments` is a
 *    string built by concatenation and is only valid JSON once the stream ends.
 */

interface OpenAiMessage {
  role: string;
  content: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface OpenAiToolDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: OpenAiToolDelta[] };
    message?: OpenAiBlockingMessage;
  }>;
  error?: { message?: string };
}

interface OpenAiBlockingMessage {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
}

interface ToolAcc {
  id: string;
  name: string;
  args: string;
}

export function toOpenAiMessages(messages: AgentMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', content: m.content, tool_call_id: m.toolCallId });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      out.push({
        role: 'assistant',
        // `content` must be null, not '', when the turn was tool-only.
        content: m.content ? m.content : null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        })),
      });
      continue;
    }
    out.push({ role: m.role, content: m.role === 'user' && m.images?.length ? [{ type: 'text', text: m.content }, ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } }))] : m.content });
  }
  return out;
}

export function toOpenAiTools(tools: ToolDef[]): Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * On localhost, route NVIDIA NIM through the Vite dev proxy to eliminate CORS.
 * NOTE: the proxy is dev-only (see vite.config.ts) — a static production build
 * has no such rewrite.
 */
export function endpointFor(baseUrl: string): string {
  let effective = baseUrl;
  if (
    typeof window !== 'undefined' &&
    /^(localhost|127\.0\.0\.1)/.test(window.location.hostname) &&
    effective.includes('integrate.api.nvidia.com')
  ) {
    effective = effective.replace(/https?:\/\/integrate\.api\.nvidia\.com/, '/api/nvidia');
  }
  return effective.replace(/\/$/, '') + '/chat/completions';
}

export function cleanApiKey(key: string): string {
  let cleaned = (key || '').trim();
  if (/^bearer\s+/i.test(cleaned)) cleaned = cleaned.replace(/^bearer\s+/i, '').trim();
  return cleaned.replace(/^["']|["']$/g, '').trim();
}

function headersFor(opts: ProviderCallOptions): Record<string, string> {
  const key = cleanApiKey(opts.apiKey || '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
  if (opts.baseUrl.includes('openrouter.ai')) {
    headers['HTTP-Referer'] = 'https://github.com/MayureshTardekar/Dexter-Writer';
    headers['X-Title'] = 'Dexter Write';
  }
  return headers;
}

export function parseToolArgs(raw: string): Record<string, unknown> {
  const parsed = tryParseJson<Record<string, unknown>>(raw || '{}');
  return parsed && typeof parsed === 'object' ? parsed : {};
}

/** Turn the index-keyed accumulator into ordered, complete tool calls. */
export function finalizeToolCalls(acc: Map<number, ToolAcc>): ToolCall[] {
  const out: ToolCall[] = [];
  for (const idx of [...acc.keys()].sort((a, b) => a - b)) {
    const slot = acc.get(idx);
    if (!slot || !slot.name) continue;
    out.push({ id: slot.id || `call_${idx}`, name: slot.name, args: parseToolArgs(slot.args) });
  }
  return out;
}

function accumulate(acc: Map<number, ToolAcc>, deltas: OpenAiToolDelta[]): void {
  for (const tc of deltas) {
    const idx = typeof tc.index === 'number' ? tc.index : 0;
    const slot = acc.get(idx) ?? { id: '', name: '', args: '' };
    if (tc.id) slot.id = tc.id;
    if (tc.function?.name) slot.name += tc.function.name;
    // `arguments` always arrives in fragments — concatenate, parse at the end.
    if (tc.function?.arguments) slot.args += tc.function.arguments;
    acc.set(idx, slot);
  }
}

async function* parseStream(res: Response, signal?: AbortSignal): ProviderStream {
  const acc = new Map<number, ToolAcc>();
  let emittedText = false;
  let reasoning = '';

  for await (const payload of readSseLines(res, signal)) {
    const data = tryParseJson<OpenAiStreamChunk>(payload);
    if (!data) continue;
    if (data.error?.message) {
      yield { type: 'notice', message: `Provider reported: ${data.error.message.slice(0, 200)}` };
      continue;
    }
    const choice = data.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (!delta) continue;

    if (typeof delta.content === 'string' && delta.content) {
      emittedText = true;
      yield { type: 'text', delta: delta.content };
    } else if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      // Reasoning models (DeepSeek-R1 and friends) put their only prose here.
      // Buffer it and emit at the end ONLY if no real content ever arrived.
      reasoning += delta.reasoning_content;
    }
    if (delta.tool_calls) accumulate(acc, delta.tool_calls);
  }

  if (!emittedText && reasoning.trim()) yield { type: 'text', delta: reasoning };
  for (const call of finalizeToolCalls(acc)) yield { type: 'tool_call', call };
}

async function* parseBlocking(res: Response): ProviderStream {
  const data = tryParseJson<OpenAiStreamChunk>(await res.text());
  const msg: OpenAiBlockingMessage = data?.choices?.[0]?.message ?? {};
  const text = typeof msg.content === 'string' && msg.content
    ? msg.content
    : (typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '');
  if (text) yield { type: 'text', delta: text };
  const calls = msg.tool_calls ?? [];
  for (let i = 0; i < calls.length; i++) {
    const name = calls[i].function?.name;
    if (!name) continue;
    yield {
      type: 'tool_call',
      call: { id: calls[i].id || `call_${i}`, name, args: parseToolArgs(calls[i].function?.arguments ?? '{}') },
    };
  }
}

export function describeHttpError(status: number, body: string, label = 'Provider'): string {
  const snippet = body.slice(0, 300);
  if (status === 401 || status === 403) {
    return `${label} rejected your API key (${status}). Re-enter it in BYOK, or switch to Ollama for local use.`;
  }
  if (status === 404) {
    return `${label} has no such model (404). Check the model ID in BYOK. Details: ${snippet}`;
  }
  if (status === 429) {
    return `${label} rate limit reached (429). Wait a moment, or switch provider/model in BYOK.`;
  }
  if (status === 503 || status === 502 || status === 504) {
    return `${label} is temporarily busy (${status}). Retry in a few seconds, or switch model in BYOK.`;
  }
  return `${label} error ${status}: ${snippet}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stream a completion, degrading gracefully for free-tier models:
 * tools unsupported → retry tool-free; streaming unsupported → retry blocking;
 * transient 429/503 → one backoff retry.
 */
export async function* streamOpenAiCompatible(opts: ProviderCallOptions): ProviderStream {
  const url = endpointFor(opts.baseUrl);
  const headers = headersFor(opts);
  const messages = toOpenAiMessages(opts.messages);
  const toolDefs = toOpenAiTools(opts.tools);

  const useTools = toolDefs.length > 0;
  let useStream = opts.stream !== false;
  let backedOff = false;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (opts.signal?.aborted) return;
    const body = JSON.stringify({
      model: opts.model,
      messages,
      ...(useTools ? { tools: toolDefs, tool_choice: 'auto' } : {}),
      ...(useStream ? { stream: true } : {}),
      temperature: opts.temperature ?? 0.4,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    });

    const res = await fetch(url, { method: 'POST', headers, body, signal: opts.signal });

    if (res.ok) {
      if (useStream) yield* parseStream(res, opts.signal);
      else yield* parseBlocking(res);
      return;
    }

    const err = await errorBody(res);

    // Model doesn't support function calling — run tool-free rather than fail.
    if (useTools && (res.status === 400 || res.status === 422) && /tool|function/i.test(err)) {
      throw new Error('This model rejected editing tools. Choose a model with tool support in AI Settings. No edits were applied.');
    }
    // Model or gateway doesn't support SSE.
    if (useStream && (res.status === 400 || res.status === 404 || res.status === 422) && /stream/i.test(err)) {
      useStream = false;
      yield { type: 'notice', message: 'This model does not support streaming — waiting for the full reply.' };
      continue;
    }
    if (!backedOff && (res.status === 429 || res.status === 503)) {
      backedOff = true;
      await sleep(1800);
      continue;
    }
    throw new Error(describeHttpError(res.status, err));
  }
  throw new Error('Provider request failed after several attempts. Try another model in BYOK.');
}
