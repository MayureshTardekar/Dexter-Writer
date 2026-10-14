import { describe, it, expect, beforeEach } from 'vitest';
import { readSseLines, sseDataPayload, tryParseJson } from '../agent/sse';
import { buildDocContext, buildSystemPrompt, numberLines } from '../agent/prompt';
import {
  canCallNow,
  clearCompletionCache,
  getCachedCompletion,
  MIN_CALL_INTERVAL_MS,
  noteCallFailed,
  noteCallStarted,
  noteCallSucceeded,
  resetBreaker,
  sanitizeCompletion,
  setCachedCompletion,
} from '../agent/completion';
import { sanitizeInlineEdit } from '../agent/inlineEdit';
import { shouldSuggest } from '../monacoAiCompletion';

/** Minimal Response stand-in: readSseLines only touches `body.getReader()`. */
function fakeSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return { body: stream } as unknown as Response;
}

async function collect(res: Response, signal?: AbortSignal): Promise<string[]> {
  const out: string[] = [];
  for await (const line of readSseLines(res, signal)) out.push(line);
  return out;
}

describe('SSE reader', () => {
  it('yields data payloads and ignores framing noise', async () => {
    const lines = await collect(fakeSseResponse([
      ': keep-alive\n',
      'event: content_block_delta\n',
      'data: {"a":1}\n',
      '\n',
      'data: [DONE]\n',
    ]));
    expect(lines).toEqual(['{"a":1}']);
  });

  it('reassembles a frame split across network chunks', async () => {
    const lines = await collect(fakeSseResponse(['data: {"he', 'llo":"wor', 'ld"}\n']));
    expect(lines).toEqual(['{"hello":"world"}']);
  });

  it('flushes a trailing frame with no newline terminator', async () => {
    expect(await collect(fakeSseResponse(['data: {"last":true}']))).toEqual(['{"last":true}']);
  });

  it('tolerates CRLF line endings', async () => {
    expect(await collect(fakeSseResponse(['data: {"a":1}\r\n']))).toEqual(['{"a":1}']);
  });

  it('stops early when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    expect(await collect(fakeSseResponse(['data: {"a":1}\n']), ac.signal)).toEqual([]);
  });

  it('throws a clear error when the response has no body', async () => {
    await expect(collect({ body: null } as unknown as Response)).rejects.toThrow(/streaming is unavailable/i);
  });

  it('classifies individual lines', () => {
    expect(sseDataPayload('data: x')).toBe('x');
    expect(sseDataPayload('data: [DONE]')).toBeNull();
    expect(sseDataPayload('data:')).toBeNull();
    expect(sseDataPayload('event: foo')).toBeNull();
  });

  it('returns null rather than throwing on malformed JSON', () => {
    expect(tryParseJson('{"a":')).toBeNull();
    expect(tryParseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });
});

describe('prompt: line-numbered document context', () => {
  it('right-aligns numbers and separates with the gutter mark', () => {
    const out = numberLines(['a', 'b'].join('\n'));
    expect(out).toBe('1│a\n2│b');
  });

  it('pads so the gutter stays aligned past line 9', () => {
    const out = numberLines(Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n'));
    expect(out.split('\n')[0]).toBe(' 1│l0');
    expect(out.split('\n')[9]).toBe('10│l9');
  });

  it('offsets numbering when reading a slice', () => {
    expect(numberLines('x', 42)).toBe('42│x');
  });

  it('passes a small document through whole', () => {
    expect(buildDocContext('a\nb')).toBe('1│a\n2│b');
  });

  it('describes an empty document explicitly', () => {
    expect(buildDocContext('')).toMatch(/empty/i);
  });

  it('windows an oversized document and points at the search tools', () => {
    const big = Array.from({ length: 900 }, (_, i) => `line ${i + 1} ${'x'.repeat(60)}`).join('\n');
    const out = buildDocContext(big, { maxDocChars: 4000, headLines: 20, tailLines: 10 });
    expect(out).toMatch(/^ *1│line 1/m);
    expect(out).toMatch(/LINES 21-890 OMITTED/);
    expect(out).toMatch(/search_document/);
    expect(out).toMatch(/891│line 891/);
    // The middle really is absent.
    expect(out).not.toMatch(/\b400│/);
  });

  it('truncates rather than windowing when the document is few but huge lines', () => {
    const out = buildDocContext('x'.repeat(9000), { maxDocChars: 1000 });
    expect(out).toMatch(/\[truncated\]/);
  });
});

describe('buildSystemPrompt', () => {
  it('warns that the gutter is not part of the document', () => {
    const p = buildSystemPrompt('latex', '', '\\section{A}');
    expect(p).toMatch(/line-number gutter/i);
    expect(p).toMatch(/Never include it in old_string/);
  });

  it('states the edit-tool policy and the line-drift caveat', () => {
    const p = buildSystemPrompt('markdown', '', '# A');
    expect(p).toMatch(/Default to edit_document/);
    expect(p).toMatch(/stale/i);
    expect(p).toMatch(/Do not repeat the identical failing call/i);
  });

  it('includes the project file list only when supplied', () => {
    expect(buildSystemPrompt('markdown', '', 'x')).not.toMatch(/PROJECT FILES/);
    const p = buildSystemPrompt('markdown', '', 'x', '', '', '', { fileList: '- a.md (markdown, 1 lines)' });
    expect(p).toMatch(/PROJECT FILES/);
    expect(p).toContain('a.md');
  });

  it('embeds the document with numbered lines', () => {
    expect(buildSystemPrompt('markdown', '', 'hello')).toContain('1│hello');
  });
});

describe('completion sanitizing', () => {
  it('strips a wrapping code fence', () => {
    expect(sanitizeCompletion('```latex\n\\textbf{hi}\n```', '')).toBe('\\textbf{hi}');
  });

  it('strips a one-sided fence', () => {
    expect(sanitizeCompletion('```\nhello', '')).toBe('hello');
  });

  it('removes an echoed prefix tail', () => {
    expect(sanitizeCompletion('the quick brown fox jumps', 'the quick brown ')).toBe('fox jumps');
  });

  it('does not double whitespace the user already typed', () => {
    expect(sanitizeCompletion('   world', 'hello ')).toBe('world');
  });

  it('returns empty for blank or whitespace-only output', () => {
    expect(sanitizeCompletion('', 'x')).toBe('');
    expect(sanitizeCompletion('   \n ', 'x')).toBe('');
  });

  it('caps very long completions at a line boundary', () => {
    const long = Array.from({ length: 50 }, (_, i) => `line ${i} padding padding`).join('\n');
    const out = sanitizeCompletion(long, '');
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.endsWith('padding')).toBe(true);
  });
});

describe('inline edit sanitizing', () => {
  it('strips fences and conversational lead-ins', () => {
    expect(sanitizeInlineEdit('```md\n## Skills\n```')).toBe('## Skills');
    expect(sanitizeInlineEdit("Here's the rewrite:\n## Skills")).toBe('## Skills');
    expect(sanitizeInlineEdit('Replacement text:\n- a')).toBe('- a');
  });

  it('leaves ordinary text untouched', () => {
    expect(sanitizeInlineEdit('- Shipped the thing')).toBe('- Shipped the thing');
  });
});

describe('completion cache', () => {
  beforeEach(() => clearCompletionCache());

  it('keys on the prefix tail so a long document still hits', () => {
    setCachedCompletion(`${'a'.repeat(1000)}tail`, 'suggestion');
    expect(getCachedCompletion(`${'b'.repeat(1000)}tail`)).toBeUndefined();
    expect(getCachedCompletion(`${'a'.repeat(1000)}tail`)).toBe('suggestion');
  });

  it('caches empty results too, so dead spots do not re-bill', () => {
    setCachedCompletion('p', '');
    expect(getCachedCompletion('p')).toBe('');
  });

  it('evicts the oldest entry past the cap', () => {
    for (let i = 0; i < 55; i++) setCachedCompletion(`key-${i}`, `v${i}`);
    expect(getCachedCompletion('key-0')).toBeUndefined();
    expect(getCachedCompletion('key-54')).toBe('v54');
  });
});

describe('completion rate limiting + circuit breaker', () => {
  beforeEach(() => resetBreaker());

  it('enforces a minimum interval between calls', () => {
    noteCallStarted(10_000);
    expect(canCallNow(10_000 + MIN_CALL_INTERVAL_MS - 1)).toBe(false);
    expect(canCallNow(10_000 + MIN_CALL_INTERVAL_MS)).toBe(true);
  });

  it('trips only after three consecutive rate-limit failures', () => {
    expect(noteCallFailed('429 rate limit reached')).toBe(false);
    expect(noteCallFailed('quota exceeded')).toBe(false);
    expect(noteCallFailed('503 busy')).toBe(true);
  });

  it('does not trip on unrelated errors', () => {
    expect(noteCallFailed('bad model id')).toBe(false);
    expect(noteCallFailed('bad model id')).toBe(false);
    expect(noteCallFailed('bad model id')).toBe(false);
  });

  it('a success resets the streak', () => {
    noteCallFailed('429');
    noteCallFailed('429');
    noteCallSucceeded();
    expect(noteCallFailed('429')).toBe(false);
  });
});

describe('ghost-text trigger rule', () => {
  it('suggests at the end of a line', () => {
    expect(shouldSuggest('## Experience\n- Built ', '')).toBe(true);
    expect(shouldSuggest('hello ', '\nnext line')).toBe(true);
  });

  it('stays silent in the middle of existing text', () => {
    expect(shouldSuggest('hello ', 'world')).toBe(false);
  });

  it('stays silent with almost no context', () => {
    expect(shouldSuggest('', '')).toBe(false);
    expect(shouldSuggest(' \n ', '')).toBe(false);
  });
});
