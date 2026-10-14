import { streamProvider } from './providers';

/**
 * Ctrl+I inline edit: rewrite the selection (or generate at the cursor) from a
 * one-line instruction, streamed into an in-editor widget.
 *
 * Deliberately tool-free and single-shot. Asking the chat agent to call
 * replace_lines on a range the user already selected is strictly worse: it
 * costs extra rounds and can miss the range. Here the range is known, so the
 * model only has to produce replacement text.
 * See AI_AGENT_ROADMAP.md §9.2.
 */

export interface InlineEditRequest {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  mode: string;
  fileName?: string;
  /** The selected text to rewrite. Empty means "generate at the cursor". */
  selected: string;
  /** Context window before the selection. */
  before: string;
  /** Context window after the selection. */
  after: string;
  instruction: string;
  /** Macro names (no backslash) defined in the document, for LaTeX fidelity. */
  macros?: string[];
  signal?: AbortSignal;
}

export const CONTEXT_LINES = 40;
const MAX_CONTEXT_CHARS = 4000;

function systemFor(req: InlineEditRequest): string {
  const syntaxRule = req.mode === 'latex'
    ? 'LaTeX: keep braces balanced, keep math inside $...$, and reuse only macros that already exist.'
    : req.mode === 'typst'
      ? 'Typst: = headings, $...$ math, - lists. Never invent #directives.'
      : 'Markdown (GitHub flavoured), with $...$ math where appropriate.';
  const macroRule = req.macros && req.macros.length > 0
    ? `\n- Macros defined in this document (reuse, never invent others): ${req.macros.map((m) => `\\${m}`).join(', ')}`
    : '';
  const task = req.selected
    ? 'Rewrite the SELECTED text according to the instruction.'
    : 'Generate new text to insert at the cursor according to the instruction.';

  return `You are an inline edit engine inside a ${req.mode} document editor${req.fileName ? ` editing "${req.fileName}"` : ''}.
${task}
RULES:
- Output ONLY the replacement text. No explanation, no commentary, no code fences, no preamble.
- Do not include any surrounding context — only what should replace the selection.
- Preserve the original indentation style and markup conventions.
- Match the syntax exactly: ${syntaxRule}${macroRule}
- If the instruction asks for résumé bullets, use Google's X-Y-Z formula and open with a strong action verb.
- Change only what the instruction asks for.`;
}

function buildUser(req: InlineEditRequest): string {
  const before = req.before.slice(-MAX_CONTEXT_CHARS);
  const after = req.after.slice(0, MAX_CONTEXT_CHARS);
  return [
    '<context_before>', before, '</context_before>',
    '<selection>', req.selected, '</selection>',
    '<context_after>', after, '</context_after>',
    '',
    `INSTRUCTION: ${req.instruction}`,
    '',
    'Replacement text:',
  ].join('\n');
}

/** Strip fences/commentary the model may wrap around the replacement. */
export function sanitizeInlineEdit(raw: string): string {
  let t = raw ?? '';
  const fenced = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/.exec(t);
  if (fenced) t = fenced[1];
  t = t.replace(/^\s*```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  // Drop a leading "Here is..." style lead-in if the model ignored the rules.
  t = t.replace(/^(?:here(?:'s| is)[^\n:]*:|replacement text:)\s*\n?/i, '');
  return t.replace(/^\n+/, '').trimEnd();
}

/** Stream the replacement text, yielding deltas for live display. */
export async function* streamInlineEdit(req: InlineEditRequest): AsyncGenerator<string, void, void> {
  for await (const chunk of streamProvider({
    provider: req.provider,
    apiKey: req.apiKey,
    baseUrl: req.baseUrl,
    model: req.model,
    messages: [
      { role: 'system', content: systemFor(req) },
      { role: 'user', content: buildUser(req) },
    ],
    tools: [],
    signal: req.signal,
    temperature: 0.3,
  })) {
    if (chunk.type === 'text') yield chunk.delta;
  }
}

/** Convenience: run to completion and return the sanitized replacement. */
export async function runInlineEdit(req: InlineEditRequest): Promise<string> {
  let out = '';
  for await (const delta of streamInlineEdit(req)) out += delta;
  return sanitizeInlineEdit(out);
}
