/**
 * Shared Server-Sent Events reader used by every provider adapter.
 *
 * All three transports (OpenAI-compatible, Gemini `alt=sse`, Anthropic) speak
 * SSE over a fetch ReadableStream, so the framing logic lives here once.
 * See AI_AGENT_ROADMAP.md §5.4.
 */

/**
 * Yields the payload of each `data:` line, skipping comments, `event:` lines,
 * blank separators and the `[DONE]` sentinel.
 *
 * Cancels the underlying reader on abort or early return so the socket is never
 * leaked when the user hits Stop.
 */
export async function* readSseLines(res: Response, signal?: AbortSignal): AsyncGenerator<string, void, void> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('This response has no readable body — streaming is unavailable.');
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        const payload = sseDataPayload(line);
        if (payload !== null) yield payload;
        nl = buf.indexOf('\n');
      }
    }
    // Flush a trailing frame that arrived without a newline terminator.
    const tail = sseDataPayload(buf.replace(/\r$/, ''));
    if (tail !== null) yield tail;
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Returns the payload of a `data:` line, or null for anything else. */
export function sseDataPayload(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  return payload;
}

/**
 * Parses an SSE payload, returning null instead of throwing.
 *
 * Providers interleave keep-alives and occasionally split a frame, so callers
 * must tolerate unparseable payloads rather than aborting the stream.
 */
export function tryParseJson<T = unknown>(payload: string): T | null {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

/**
 * Reads a fetch error body without throwing, truncated for display.
 * Used by every adapter to build actionable error messages.
 */
export async function errorBody(res: Response, limit = 500): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, limit);
  } catch {
    return `(no response body)`;
  }
}
