import { extractLatexMacros } from '../latexParser';

/**
 * System prompt construction.
 *
 * Two things matter here beyond wording:
 *
 * 1. The document is embedded **line-numbered**. The old prompt pasted raw
 *    text and then asked the model for "exact line numbers", forcing it to
 *    count newlines by eye — the main cause of off-by-N edits.
 *    (AI_AGENT_ROADMAP.md §2 P3.)
 * 2. Large documents are budgeted into head + tail windows with an explicit
 *    instruction to use search_document / read_document for the middle,
 *    instead of being silently truncated at 10k chars.
 */

/** The gutter separator. Deliberately non-ASCII so it can't be confused with content. */
const GUTTER = '│';

export interface PromptOptions {
  /** Above this, the document is windowed instead of sent whole. */
  maxDocChars?: number;
  headLines?: number;
  tailLines?: number;
  /** Rendered `list_files` summary, so the model knows the project exists. */
  fileList?: string;
}

const DEFAULTS = { maxDocChars: 24000, headLines: 120, tailLines: 60 };

/**
 * Prefix each line with a right-aligned line number and a gutter mark.
 * `from` is the 1-indexed number of the first line in `content`.
 */
export function numberLines(content: string, from = 1): string {
  const lines = content.split('\n');
  const width = String(from + lines.length - 1).length;
  return lines.map((l, i) => `${String(from + i).padStart(width, ' ')}${GUTTER}${l}`).join('\n');
}

function clampText(s: string, limit: number): string {
  return s.length <= limit ? s : `${s.slice(0, limit)}\n… [truncated]`;
}

/**
 * Build the line-numbered document block, windowing it when oversized.
 * Exported for tests.
 */
export function buildDocContext(content: string, opts: PromptOptions = {}): string {
  const maxDocChars = opts.maxDocChars ?? DEFAULTS.maxDocChars;
  const headLines = opts.headLines ?? DEFAULTS.headLines;
  const tailLines = opts.tailLines ?? DEFAULTS.tailLines;

  if (!content) return '(the document is currently empty — write the whole file)';
  if (content.length <= maxDocChars) return numberLines(content);

  const lines = content.split('\n');
  // Few but very long lines: windowing by line count won't help, so truncate.
  if (lines.length <= headLines + tailLines + 10) {
    return clampText(numberLines(content), maxDocChars);
  }

  const budget = Math.floor(maxDocChars / 2);
  const head = clampText(numberLines(lines.slice(0, headLines).join('\n'), 1), budget);
  const tailStart = lines.length - tailLines + 1;
  const tail = clampText(numberLines(lines.slice(tailStart - 1).join('\n'), tailStart), budget);

  return [
    head,
    '',
    `[… LINES ${headLines + 1}-${tailStart - 1} OMITTED (${lines.length} lines total). `
      + `Use search_document to locate text, or read_document with a line range to see this region. `
      + `Do NOT assume what is in the omitted region. …]`,
    '',
    tail,
  ].join('\n');
}

/**
 * Detect user-defined LaTeX macros (\newcommand, \renewcommand, \def) so the
 * prompt can tell the model to REUSE them — instead of hardcoding template
 * macros (e.g. Jake's \resumeItem) that may not exist, which would break
 * compilation. Returns names WITHOUT the backslash.
 */
export function detectDocMacros(content: string, docMode: string): string[] {
  if (docMode !== 'latex' || !content) return [];
  try {
    const { macros } = extractLatexMacros(content);
    return [...macros.keys()].slice(0, 20);
  } catch {
    return [];
  }
}

function modeRulesFor(docMode: string): string {
  if (docMode === 'latex') {
    return '- LaTeX hygiene (non-negotiable): braces must balance — every { must close; NEVER put enumitem options like [nosep,leftmargin=*] or spacing commands (\\vspace, \\hspace) into body text; reuse the document\'s existing macros and environments; keep \\\\ line breaks clean (never \\\\4pt); math stays inside $...$ or $$...$$.';
  }
  if (docMode === 'typst') {
    return '- Typst hygiene: = / == headings, $...$ math, - list items; NEVER invent #directives or functions; reuse what the document already uses.';
  }
  return '- Markdown hygiene: keep headings (#), GFM tables, and $...$ / $$...$$ math valid; never break fenced code blocks.';
}

/**
 * The agent system prompt.
 *
 * NOTE: the first six parameters are positional for backwards compatibility
 * with `aiGateway.buildSystemPrompt` and its existing test suite. New options
 * go in the trailing `opts` object.
 */
export function buildSystemPrompt(
  docMode: string,
  outlineText: string,
  docExcerpt: string,
  externalHint = '',
  fileName = '',
  extraContext = '',
  opts: PromptOptions = {},
): string {
  const targetDesc = fileName ? `the user's active file "${fileName}" (${docMode} format)` : `the user's active ${docMode} document`;
  const docBlock = buildDocContext(docExcerpt, opts);

  return `You are Dexter Write, an AI document editor with direct MCP tools over ${targetDesc}. Work like a careful IDE assistant, not a chatbot.

WORKFLOW (follow strictly):
1. If the user asks a QUESTION, answer it in chat first. Only call tools when they asked for an edit.
2. READ BEFORE YOU WRITE: before any insert/replace, call read_document_content on the exact line range you plan to change (or get_document_outline first for large docs). Never assume what is in the file.
3. Be SURGICAL: use the smallest range that covers the change. Use insert_content only for genuinely new blocks. NEVER re-insert the preamble (\\documentclass, #set page, imports) and NEVER duplicate a section that already exists — update it in place.
4. One coherent edit per turn; batch related hunks instead of many tiny calls.
5. RESUME & WRITING EXCELLENCE: If editing or writing resume bullets, use Google's X-Y-Z formula (Accomplished [X] measured by [Y] by doing [Z]). Start each bullet with a strong action verb (Engineered, Architected, Shipped, Automated, Optimized). Never produce generic, passive filler.

EDIT TOOL POLICY (strict):
- Default to edit_document when it is available: it matches an exact string, is immune to line drift, and fails loudly on a bad match instead of corrupting the wrong lines. Include 2-3 lines of surrounding context in old_string so the match is unique.
- Use replace_lines / insert_content for whole-section rewrites or genuinely new blocks.
- The line numbers below are for ORIENTATION ONLY. After your first edit in a turn, every later line number is stale — re-read, or switch to edit_document.
- If a tool returns an error, read it and retry with corrected arguments. Do not repeat the identical failing call.
${modeRulesFor(docMode)}
${extraContext ? `${extraContext}\n` : ''}${opts.fileList ? `\nPROJECT FILES (use list_files / read_file to work across them):\n${opts.fileList}\n` : ''}${externalHint ? `- External MCP tools are available (prefixed mcp_). Use them to fetch live data (repos, search, citations), then write results into the document with the document tools.\n${externalHint}` : '- No external MCP servers connected.'}
- If no tool is needed, answer concisely in chat.
- After tools, summarize what changed with line numbers.

DOCUMENT OUTLINE:
${outlineText || '(empty)'}

ACTIVE DOCUMENT — ${fileName || 'active file'} (${docMode}), line-numbered:
\`\`\`${docMode}
${docBlock}
\`\`\`
CRITICAL: the \`N${GUTTER}\` prefix on each line above is a line-number gutter added for your reference. It is NOT part of the document. Never include it in old_string, new_text, or any content you write back.

IF YOU ANSWER WITHOUT TOOLS:
- Preserve all preamble, macros, and unrelated sections from the document above. Never drop parts of the document unless explicitly instructed.`;
}
