import type { AgentMessage, ProviderCallOptions, ProviderStream, ToolDef } from '../types';
import { errorBody, readSseLines, tryParseJson } from '../sse';

/**
 * Google Gemini transport. See AI_AGENT_ROADMAP.md §5.2.
 *
 * Three things bite here:
 *  1. `functionResponse.response` must be a JSON OBJECT, never a bare string.
 *  2. Gemini matches responses by function NAME, not by id — consecutive tool
 *     results must be merged into one `user` content, in call order.
 *  3. Gemini accepts a reduced JSON Schema subset; unknown keywords 400 the
 *     whole request, so every tool schema goes through sanitizeSchemaForGemini.
 */

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiPart {
  inlineData?: { mimeType: string; data: string };
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

/**
 * Convert canonical messages to Gemini `contents`.
 *
 * Roles are only `user` and `model`; the system prompt is passed separately as
 * `system_instruction`, so system messages are skipped here.
 */
export function toGeminiContents(messages: AgentMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'tool') {
      const part: GeminiPart = { functionResponse: { name: m.name, response: { output: m.content } } };
      const last = out[out.length - 1];
      // Merge consecutive results so one round's responses share one content.
      if (last && last.role === 'user' && last.parts.length > 0 && last.parts.every((p) => p.functionResponse !== undefined)) {
        last.parts.push(part);
      } else {
        out.push({ role: 'user', parts: [part] });
      }
      continue;
    }

    if (m.role === 'assistant') {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args ?? {} } });
      // Never emit an empty content — Gemini rejects it.
      if (parts.length === 0) continue;
      out.push({ role: 'model', parts });
      continue;
    }

    if (!m.content) continue;
    out.push({ role: 'user', parts: [{ text: m.content }, ...(m.images ?? []).map((img) => ({ inlineData: { mimeType: img.mime, data: img.data } }))] });
  }
  return out;
}

/** JSON Schema keywords Gemini's OpenAPI subset understands. */
const ALLOWED_SCHEMA_KEYS = new Set(['type', 'description', 'enum', 'items', 'properties', 'required', 'nullable', 'format']);

/**
 * Strip JSON Schema keywords Gemini rejects ($schema, additionalProperties,
 * default, oneOf/allOf, numeric bounds, …). Recurses through properties/items.
 */
export function sanitizeSchemaForGemini(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {};
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(src)) {
    if (!ALLOWED_SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(value as Record<string, unknown>)) {
        props[pk] = sanitizeSchemaForGemini(pv);
      }
      out.properties = props;
      continue;
    }
    if (key === 'items') {
      out.items = sanitizeSchemaForGemini(value);
      continue;
    }
    out[key] = value;
  }

  // `required` must only name keys that actually exist in properties.
  if (Array.isArray(out.required) && out.properties && typeof out.properties === 'object') {
    const known = Object.keys(out.properties as Record<string, unknown>);
    out.required = (out.required as unknown[]).filter((r) => typeof r === 'string' && known.includes(r));
    if ((out.required as unknown[]).length === 0) delete out.required;
  }
  return out;
}

/**
 * Build `functionDeclarations`. Parameter-less tools omit `parameters`
 * entirely — an object schema with empty properties is rejected.
 */
export function toGeminiTools(tools: ToolDef[]): Array<{ functionDeclarations: unknown[] }> {
  if (tools.length === 0) return [];
  const declarations = tools.map((t) => {
    const params = sanitizeSchemaForGemini(t.parameters);
    const props = params.properties as Record<string, unknown> | undefined;
    const hasProps = props && Object.keys(props).length > 0;
    return hasProps
      ? { name: t.name, description: t.description, parameters: params }
      : { name: t.name, description: t.description };
  });
  return [{ functionDeclarations: declarations }];
}

function urlFor(model: string, apiKey: string, stream: boolean): string {
  const method = stream ? 'streamGenerateContent' : 'generateContent';
  // `alt=sse` is required, otherwise the response is a JSON array, not SSE.
  const query = stream ? `?alt=sse&key=${encodeURIComponent(apiKey)}` : `?key=${encodeURIComponent(apiKey)}`;
  return `${API_ROOT}/${encodeURIComponent(model)}:${method}${query}`;
}

function* partsToChunks(parts: GeminiPart[], counter: { n: number }): Generator<
  { type: 'text'; delta: string } | { type: 'tool_call'; call: { id: string; name: string; args: Record<string, unknown> } }
> {
  for (const p of parts) {
    if (typeof p.text === 'string' && p.text) {
      yield { type: 'text', delta: p.text };
    }
    if (p.functionCall?.name) {
      // Gemini issues no call ids; synthesize stable local ones.
      yield {
        type: 'tool_call',
        call: { id: `gemini_${counter.n++}`, name: p.functionCall.name, args: p.functionCall.args ?? {} },
      };
    }
  }
}

function blockNotice(data: GeminiResponse): string | null {
  const reason = data.promptFeedback?.blockReason;
  if (reason) return `Gemini blocked this request (${reason}). Rephrase the prompt or switch model.`;
  const finish = data.candidates?.[0]?.finishReason;
  if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS' && finish !== 'FINISH_REASON_UNSPECIFIED') {
    return `Gemini stopped early (${finish}).`;
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function* streamGemini(opts: ProviderCallOptions): ProviderStream {
  const systemText = opts.messages.find((m) => m.role === 'system')?.content ?? '';
  const contents = toGeminiContents(opts.messages);
  const tools = toGeminiTools(opts.tools);
  const counter = { n: 0 };

  const payload = JSON.stringify({
    ...(systemText ? { system_instruction: { parts: [{ text: systemText }] } } : {}),
    contents,
    ...(tools.length > 0 ? { tools } : {}),
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
    },
  });

  let useStream = opts.stream !== false;
  let backedOff = false;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (opts.signal?.aborted) return;

    const res = await fetch(urlFor(opts.model, opts.apiKey, useStream), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: opts.signal,
    });

    if (res.ok) {
      if (useStream) {
        for await (const raw of readSseLines(res, opts.signal)) {
          const data = tryParseJson<GeminiResponse>(raw);
          if (!data) continue;
          const notice = blockNotice(data);
          if (notice) yield { type: 'notice', message: notice };
          const parts = data.candidates?.[0]?.content?.parts;
          if (parts) yield* partsToChunks(parts, counter);
        }
      } else {
        const data = tryParseJson<GeminiResponse>(await res.text());
        if (data) {
          const notice = blockNotice(data);
          if (notice) yield { type: 'notice', message: notice };
          const parts = data.candidates?.[0]?.content?.parts;
          if (parts) yield* partsToChunks(parts, counter);
        }
      }
      return;
    }

    const err = await errorBody(res);

    // Some endpoints/models reject SSE — fall back to a single blocking call.
    if (useStream && (res.status === 400 || res.status === 404) && /alt|sse|stream/i.test(err)) {
      useStream = false;
      yield { type: 'notice', message: 'Streaming unavailable for this Gemini model — waiting for the full reply.' };
      continue;
    }
    // The free tier hits these routinely; one backoff retry usually clears it.
    if (!backedOff && (res.status === 503 || res.status === 429)) {
      backedOff = true;
      await sleep(1800);
      continue;
    }

    throw new Error(describeGeminiError(res.status, err));
  }
  throw new Error('Gemini request failed after several attempts. Try again or switch model in BYOK.');
}

export function describeGeminiError(status: number, body: string): string {
  const snippet = body.slice(0, 300);
  if (status === 400 && /API key not valid/i.test(body)) {
    return 'Gemini rejected your API key. Re-enter it in BYOK (keys look like AIza…).';
  }
  if (status === 400) return `Gemini rejected the request (400). Often a bad model ID or tool schema. Details: ${snippet}`;
  if (status === 403) return 'Gemini denied access (403). Check that the Generative Language API is enabled for your key.';
  if (status === 404) return `Gemini has no such model (404). Check the model ID in BYOK. Details: ${snippet}`;
  if (status === 429) return 'Gemini free-tier quota reached (429). Wait a minute, or switch model/provider in BYOK.';
  if (status === 503) return 'Gemini is temporarily busy (503). Retry in a few seconds, or switch model in BYOK.';
  return `Gemini error ${status}: ${snippet}`;
}
