import { collectText } from './providers';

/**
 * Ghost-text inline completion (Copilot-style Tab).
 *
 * Design constraints, from AI_AGENT_ROADMAP.md §9.1 and §10:
 *  - One SHORT, tool-free, non-streaming call. 96 tokens is plenty for a
 *    continuation, and a 2s completion is useless however good it is.
 *  - Free-tier frugality is a hard requirement: hence the prefix cache, the
 *    minimum call interval, and the circuit breaker that disables the feature
 *    after repeated rate-limit errors instead of hammering the API.
 */

export interface CompletionRequest {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Text before the cursor (already trimmed to a window by the caller). */
  prefix: string;
  /** Text after the cursor. */
  suffix: string;
  mode: string;
  fileName?: string;
  signal?: AbortSignal;
}

export const MAX_PREFIX_CHARS = 1500;
export const MAX_SUFFIX_CHARS = 500;
const MAX_COMPLETION_TOKENS = 96;
const MAX_COMPLETION_CHARS = 400;

function systemFor(mode: string, fileName?: string): string {
  const syntax = mode === 'latex'
    ? 'LaTeX. Reuse only macros already present in the context; never invent new ones. Keep braces balanced.'
    : mode === 'typst'
      ? 'Typst. Use = headings, $...$ math and - lists. Never invent #directives.'
      : 'Markdown (GitHub flavoured), with $...$ math where appropriate.';
  return `You are an inline autocomplete engine inside a ${mode} document editor${fileName ? ` editing "${fileName}"` : ''}.
Continue the text at the cursor.
RULES:
- Output ONLY the continuation. No explanation, no commentary, no code fences.
- Do not repeat any text that already appears before the cursor.
- Stay consistent with the surrounding syntax: ${syntax}
- Keep it short: finish the current sentence, line, or list item. At most 2 lines.
- If the text before the cursor is already complete and nothing useful follows, output nothing.`;
}

/**
 * Clean up a raw model completion: strip fences and commentary, and remove any
 * overlap where the model re-emitted the end of the prefix.
 */
export function sanitizeCompletion(raw: string, prefix: string): string {
  let t = raw ?? '';
  if (!t.trim()) return '';

  // Strip a wrapping code fence.
  const fenced = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(t);
  if (fenced) t = fenced[1];
  // Strip stray one-sided fences.
  t = t.replace(/^\s*```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');

  if (!t.trim()) return '';

  // Models often echo the tail of the prefix. Drop the longest overlap.
  const maxOverlap = Math.min(80, prefix.length);
  for (let n = maxOverlap; n >= 6; n -= 1) {
    const tail = prefix.slice(-n);
    if (t.startsWith(tail)) {
      t = t.slice(n);
      break;
    }
  }

  // Don't double up whitespace the user already typed.
  if (/\s$/.test(prefix)) t = t.replace(/^[ \t]+/, '');

  if (t.length > MAX_COMPLETION_CHARS) {
    // Cut at the last line break inside budget so we never emit a half token.
    const cut = t.slice(0, MAX_COMPLETION_CHARS);
    const nl = cut.lastIndexOf('\n');
    t = nl > 40 ? cut.slice(0, nl) : cut;
  }

  return t.trimEnd() === '' ? '' : t;
}

/** One completion call. Returns '' when there is nothing useful to add. */
export async function completeInline(req: CompletionRequest): Promise<string> {
  const prefix = req.prefix.slice(-MAX_PREFIX_CHARS);
  const suffix = req.suffix.slice(0, MAX_SUFFIX_CHARS);
  if (prefix.trim().length < 2) return '';

  const user = `<before_cursor>\n${prefix}\n</before_cursor>\n<after_cursor>\n${suffix}\n</after_cursor>\n\nContinuation at the cursor:`;

  const raw = await collectText({
    provider: req.provider,
    apiKey: req.apiKey,
    baseUrl: req.baseUrl,
    model: req.model,
    messages: [
      { role: 'system', content: systemFor(req.mode, req.fileName) },
      { role: 'user', content: user },
    ],
    tools: [],
    signal: req.signal,
    temperature: 0.2,
    maxTokens: MAX_COMPLETION_TOKENS,
    stream: false,
  });

  return sanitizeCompletion(raw, prefix);
}

// ---------------------------------------------------------------------------
// Prefix cache — stops cursor jiggle from re-billing the same suggestion.
// ---------------------------------------------------------------------------

const CACHE_MAX = 50;
const cache = new Map<string, string>();

export function cacheKey(prefix: string): string {
  return prefix.slice(-400);
}

export function getCachedCompletion(prefix: string): string | undefined {
  return cache.get(cacheKey(prefix));
}

export function setCachedCompletion(prefix: string, value: string): void {
  const key = cacheKey(prefix);
  // Map preserves insertion order, so the first key is the oldest.
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

export function clearCompletionCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Rate limiting + circuit breaker, so a free-tier quota can't be hammered.
// ---------------------------------------------------------------------------

export const MIN_CALL_INTERVAL_MS = 1200;
const ERROR_TRIP_THRESHOLD = 3;

let lastCallAt = 0;
let consecutiveErrors = 0;

/** False when the last call was too recent to make another. */
export function canCallNow(now = Date.now()): boolean {
  return now - lastCallAt >= MIN_CALL_INTERVAL_MS;
}

export function noteCallStarted(now = Date.now()): void {
  lastCallAt = now;
}

export function noteCallSucceeded(): void {
  consecutiveErrors = 0;
}

/**
 * Record a failure. Returns true when the breaker has tripped and the caller
 * should disable inline completion.
 */
export function noteCallFailed(message: string): boolean {
  const rateLimited = /429|rate limit|quota|503|busy|overload/i.test(message);
  consecutiveErrors = rateLimited ? consecutiveErrors + 1 : 0;
  return consecutiveErrors >= ERROR_TRIP_THRESHOLD;
}

export function resetBreaker(): void {
  consecutiveErrors = 0;
  lastCallAt = 0;
}
