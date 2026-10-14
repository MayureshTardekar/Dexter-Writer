import type { AgentMessage, ProviderCallOptions, ProviderStream, ToolDef } from '../types';
import { errorBody, readSseLines, tryParseJson } from '../sse';

/**
 * Anthropic transport. See AI_AGENT_ROADMAP.md §5.3.
 *
 * Note: direct browser calls are CORS-fragile even with the
 * `anthropic-dangerous-direct-browser-access` header, so this is a
 * best-effort path rather than a primary one for this project.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';

interface TextBlock { type: 'text'; text: string }
interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

interface AnthropicEvent {
  type?: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string };
  error?: { message?: string };
}

interface BlockAcc {
  kind: 'text' | 'tool_use';
  id: string;
  name: string;
  json: string;
}

export function toAnthropicMessages(messages: AgentMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      const block: ToolResultBlock = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        // An empty tool_result is rejected.
        content: m.content || '(no output)',
        ...(m.isError ? { is_error: true } : {}),
      };
      const last = out[out.length - 1];
      if (
        last && last.role === 'user' && Array.isArray(last.content) &&
        last.content.length > 0 && last.content.every((b) => b.type === 'tool_result')
      ) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (m.role === 'assistant') {
      const blocks: ContentBlock[] = [];
      // Never send an empty text block — it 400s.
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args ?? {} });
      }
      if (blocks.length === 0) continue;
      out.push({ role: 'assistant', content: blocks });
      continue;
    }

    if (!m.content) continue;
    out.push({ role: 'user', content: m.content });
  }
  return out;
}

export function toAnthropicTools(tools: ToolDef[]): Array<{ name: string; description: string; input_schema: unknown }> {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

export async function* streamAnthropic(opts: ProviderCallOptions): ProviderStream {
  const systemText = opts.messages.find((m) => m.role === 'system')?.content ?? '';
  const tools = toAnthropicTools(opts.tools);

  const payload = JSON.stringify({
    model: opts.model,
    // max_tokens is REQUIRED by this API.
    max_tokens: opts.maxTokens ?? 4096,
    ...(systemText ? { system: systemText } : {}),
    messages: toAnthropicMessages(opts.messages),
    ...(tools.length > 0 ? { tools } : {}),
    temperature: opts.temperature ?? 0.4,
    ...(opts.stream !== false ? { stream: true } : {}),
  });

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: payload,
    signal: opts.signal,
  });

  if (!res.ok) throw new Error(describeAnthropicError(res.status, await errorBody(res)));

  if (opts.stream === false) {
    const data = tryParseJson<{ content?: Array<Record<string, unknown>> }>(await res.text());
    for (const block of data?.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        yield { type: 'text', delta: block.text };
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        yield {
          type: 'tool_call',
          call: {
            id: typeof block.id === 'string' ? block.id : `toolu_${block.name}`,
            name: block.name,
            args: (block.input as Record<string, unknown>) ?? {},
          },
        };
      }
    }
    return;
  }

  const blocks = new Map<number, BlockAcc>();

  for await (const raw of readSseLines(res, opts.signal)) {
    const ev = tryParseJson<AnthropicEvent>(raw);
    if (!ev) continue;
    if (ev.error?.message) {
      yield { type: 'notice', message: `Anthropic reported: ${ev.error.message.slice(0, 200)}` };
      continue;
    }
    const idx = typeof ev.index === 'number' ? ev.index : 0;

    if (ev.type === 'content_block_start') {
      const kind = ev.content_block?.type === 'tool_use' ? 'tool_use' : 'text';
      blocks.set(idx, {
        kind,
        id: ev.content_block?.id ?? `toolu_${idx}`,
        name: ev.content_block?.name ?? '',
        json: '',
      });
      continue;
    }

    if (ev.type === 'content_block_delta') {
      if (ev.delta?.type === 'text_delta' && ev.delta.text) {
        yield { type: 'text', delta: ev.delta.text };
      } else if (ev.delta?.type === 'input_json_delta' && typeof ev.delta.partial_json === 'string') {
        const slot = blocks.get(idx);
        if (slot) slot.json += ev.delta.partial_json;
      }
      continue;
    }

    if (ev.type === 'content_block_stop') {
      const slot = blocks.get(idx);
      if (slot && slot.kind === 'tool_use' && slot.name) {
        const parsed = tryParseJson<Record<string, unknown>>(slot.json || '{}');
        yield { type: 'tool_call', call: { id: slot.id, name: slot.name, args: parsed ?? {} } };
      }
      blocks.delete(idx);
      continue;
    }
  }
}

export function describeAnthropicError(status: number, body: string): string {
  const snippet = body.slice(0, 300);
  if (status === 401) return 'Anthropic rejected your API key (401). Re-enter it in BYOK (sk-ant-…).';
  if (status === 429) return 'Anthropic rate limit reached (429). Wait a moment or switch provider in BYOK.';
  if (status === 529 || status === 503) return 'Anthropic is overloaded. Retry shortly, or switch provider in BYOK.';
  if (status === 0) return 'Anthropic call blocked by the browser (CORS). Use Gemini, Groq or Ollama instead.';
  return `Anthropic error ${status}: ${snippet}`;
}
