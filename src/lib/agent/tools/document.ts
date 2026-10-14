import type { ToolCall, ToolDef } from '../types';
import type { DocMode } from '../../templates';
import { getDocumentOutline } from '../../docUtils';
import { insertContent, readDocumentContent, replaceLines, validateDocEdit } from '../../virtualMcp';

/**
 * Tools that operate on the ACTIVE document.
 *
 * The headline addition is `edit_document` — exact-string search/replace.
 * Positional tools (`replace_lines`, `insert_content`) are kept, but they
 * drift: after the first edit of a turn, every line number the model computed
 * from its context is stale. String matching is position-independent and
 * fails loudly instead of corrupting the wrong lines.
 * See AI_AGENT_ROADMAP.md §7.1.
 */

/** What a tool hands back, before the loop attaches a tool call id. */
export interface ToolOutcome {
  /** Text shown to the model. Errors live here too, phrased for recovery. */
  content: string;
  isError?: boolean;
  /** Set only when the ACTIVE document changed. */
  newContent?: string;
  badge?: string;
}

const MAX_READ_CHARS = 6000;
const MAX_SEARCH_CHARS = 3000;

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

/** Every index at which `needle` occurs, scanning non-overlapping. */
export function allIndexesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = haystack.indexOf(needle);
  while (i >= 0) {
    out.push(i);
    i = haystack.indexOf(needle, i + needle.length);
  }
  return out;
}

/** 1-indexed line number containing a character offset. */
export function lineOfIndex(content: string, index: number): number {
  let line = 1;
  const stop = Math.min(index, content.length);
  for (let i = 0; i < stop; i++) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * The system prompt embeds the document with a `  12│` gutter. Models
 * occasionally copy that gutter into tool arguments. If EVERY non-empty line
 * carries one, strip it rather than failing the match.
 */
export function stripLineGutter(text: string): string {
  if (!text || !text.includes('│')) return text;
  const lines = text.split('\n');
  const re = /^\s*\d+│/;
  if (!lines.every((l) => l === '' || re.test(l))) return text;
  return lines.map((l) => l.replace(re, '')).join('\n');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Exact-string replace. Shared by `edit_document` (active file) and
 * `edit_file` (any project file), hence the `label` for error messages.
 */
export function applyStringEdit(
  content: string,
  args: Record<string, unknown>,
  label = 'edit_document',
): ToolOutcome {
  const oldStr = stripLineGutter(String(args.old_string ?? ''));
  const newStr = stripLineGutter(String(args.new_string ?? ''));
  const replaceAll = args.replace_all === true;

  if (!oldStr) {
    return { content: `${label} failed: old_string cannot be empty. To add brand-new text, use insert_content with a target_line.`, isError: true };
  }
  if (oldStr === newStr) {
    return { content: `${label} failed: no-op — old_string and new_string are identical.`, isError: true };
  }
  if (!content) {
    return { content: `${label} failed: the file is empty, so there is nothing to match. Use insert_content or replace_lines to write the initial content.`, isError: true };
  }

  const hits = allIndexesOf(content, oldStr);

  if (hits.length === 0) {
    return {
      content:
        `${label} failed: old_string was not found. The text may differ in whitespace, `
        + 'indentation or wording from what you expected — call search_document with a short distinctive phrase, '
        + 'or read_document_content on the relevant range, then retry with the exact text.',
      isError: true,
    };
  }

  if (hits.length > 1 && !replaceAll) {
    const lines = hits.slice(0, 10).map((h) => lineOfIndex(content, h));
    return {
      content:
        `${label} failed: old_string matched ${hits.length} times (lines ${lines.join(', ')}`
        + `${hits.length > 10 ? ', …' : ''}). Add surrounding context so the match is unique, or set replace_all: true `
        + 'if you really intend to change every occurrence.',
      isError: true,
    };
  }

  if (replaceAll) {
    const next = content.split(oldStr).join(newStr);
    return {
      content: `Replaced ${hits.length} occurrence(s) of the target text.`,
      newContent: next,
      badge: `✏️ Replaced ${hits.length}×`,
    };
  }

  const at = hits[0];
  const next = content.slice(0, at) + newStr + content.slice(at + oldStr.length);
  const startLine = lineOfIndex(content, at);
  const endLine = startLine + Math.max(0, newStr.split('\n').length - 1);
  return {
    content: `Edit applied at lines ${startLine}-${endLine}. Line numbers after this point may have shifted; re-read before any further positional edit.`,
    newContent: next,
    badge: `✏️ Edited lines ${startLine}-${endLine}`,
  };
}

function searchDocument(content: string, args: Record<string, unknown>): ToolOutcome {
  const pattern = String(args.pattern ?? '');
  if (!pattern) return { content: 'search_document failed: pattern is required.', isError: true };
  if (!content) return { content: 'The document is empty — nothing to search.', isError: false };

  const isRegex = args.is_regex === true;
  const caseSensitive = args.case_sensitive === true;
  const max = clampInt(args.max_results, 1, 200, 30);
  const ctx = clampInt(args.context_lines, 0, 5, 0);

  let re: RegExp;
  try {
    re = new RegExp(isRegex ? pattern : escapeRegex(pattern), caseSensitive ? '' : 'i');
  } catch (e) {
    return {
      content: `search_document failed: invalid regular expression — ${e instanceof Error ? e.message : String(e)}. Retry with is_regex: false to search literally.`,
      isError: true,
    };
  }

  const lines = content.split('\n');
  const rows: string[] = [];
  let found = 0;
  for (let i = 0; i < lines.length && found < max; i++) {
    if (!re.test(lines[i])) continue;
    found += 1;
    const from = Math.max(0, i - ctx);
    const to = Math.min(lines.length - 1, i + ctx);
    for (let j = from; j <= to; j++) {
      rows.push(`${j + 1}${j === i ? ':' : '-'} ${lines[j]}`.slice(0, 300));
    }
    if (ctx > 0) rows.push('--');
  }

  if (found === 0) {
    return { content: `No match for ${isRegex ? 'regex' : 'text'} "${pattern.slice(0, 80)}". Try a shorter or differently-cased phrase.`, isError: false };
  }
  let body = rows.join('\n');
  if (body.length > MAX_SEARCH_CHARS) body = `${body.slice(0, MAX_SEARCH_CHARS)}\n… [output truncated]`;
  return {
    content: `${found} match(es)${found >= max ? ` (capped at ${max})` : ''}:\n${body}`,
    badge: `🔍 Searched "${pattern.slice(0, 24)}" · ${found} hit(s)`,
  };
}

/** Run a document tool. Pure: takes content in, returns the next content out. */
export function executeDocumentTool(content: string, mode: DocMode, call: ToolCall): ToolOutcome {
  const a = call.args ?? {};

  switch (call.name) {
    case 'read_document_content':
    case 'get_document_content': {
      if (!content) return { content: '(the document is empty)', badge: '🛠️ Read document' };
      const start = a.start_line === undefined ? undefined : clampInt(a.start_line, 1, 1_000_000, 1);
      const end = a.end_line === undefined ? undefined : clampInt(a.end_line, 1, 1_000_000, 1);
      const text = readDocumentContent(content, start, end);
      const from = start ?? 1;
      const numbered = text
        .split('\n')
        .map((l, i) => `${from + i}: ${l}`)
        .join('\n');
      const body = numbered.length > MAX_READ_CHARS ? `${numbered.slice(0, MAX_READ_CHARS)}\n… [truncated — narrow the range]` : numbered;
      return { content: body, badge: `🛠️ Read lines ${from}-${end ?? content.split('\n').length}` };
    }

    case 'get_document_outline': {
      const outline = getDocumentOutline(content, mode);
      const text = outline.map((o) => `${'  '.repeat(Math.max(0, o.level - 1))}- ${o.title} (line ${o.line})`).join('\n');
      return {
        content: text || '(no headings found — the document has no section structure yet)',
        badge: `🗂️ Outline · ${outline.length} heading(s)`,
      };
    }

    case 'search_document':
      return searchDocument(content, a);

    case 'edit_document':
      return applyStringEdit(content, a);

    case 'insert_content':
    case 'insert_text': {
      const problem = validateDocEdit(content, { name: 'insert_content', args: a });
      if (problem) return { content: `insert_content REJECTED — not applied. ${problem}`, isError: true };
      const text = stripLineGutter(String(a.text ?? a.content ?? ''));
      const target = clampInt(a.target_line, 1, 1_000_000, 1);
      const position = a.position === 'before' ? 'before' : 'after';
      const r = insertContent(content, target, position, text);
      return {
        content: `${r.message}. Line numbers below line ${target} have shifted.`,
        newContent: r.newContent,
        badge: `✨ Inserted at line ${target}`,
      };
    }

    case 'replace_lines': {
      const problem = validateDocEdit(content, { name: 'replace_lines', args: a });
      if (problem) return { content: `replace_lines REJECTED — not applied. ${problem}`, isError: true };
      const newText = stripLineGutter(String(a.new_text ?? a.replacement_text ?? a.text ?? ''));
      const start = clampInt(a.start_line, 1, 1_000_000, 1);
      const end = clampInt(a.end_line, 1, 1_000_000, start);
      const r = replaceLines(content, start, end, newText);
      return {
        content: `${r.message}. Line numbers after line ${start} may have shifted.`,
        newContent: r.newContent,
        badge: `⚡ Replaced lines ${start}-${end}`,
      };
    }

    default:
      return { content: `Unknown document tool: ${call.name}`, isError: true };
  }
}

export const DOCUMENT_TOOL_NAMES = new Set([
  'read_document_content', 'get_document_content', 'get_document_outline',
  'search_document', 'edit_document', 'insert_content', 'insert_text', 'replace_lines',
]);

export const DOCUMENT_TOOL_DEFS: ToolDef[] = [
  {
    name: 'read_document_content',
    description: 'Read line-numbered text from the active document. Call this before editing a range you have not seen.',
    kind: 'read',
    parameters: {
      type: 'object',
      properties: {
        start_line: { type: 'integer', description: 'Starting line, 1-indexed. Defaults to 1.' },
        end_line: { type: 'integer', description: 'Ending line, inclusive.' },
      },
    },
  },
  {
    name: 'get_document_outline',
    description: 'Return the structural outline (markdown #, LaTeX \\section, Typst =) with line numbers. Cheap — use it to orient yourself in a large document.',
    kind: 'read',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'search_document',
    description: 'Find text in the active document and return matching lines with their line numbers. Use this to locate the exact text to pass to edit_document.',
    kind: 'read',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Text or regular expression to find.' },
        is_regex: { type: 'boolean', description: 'Treat pattern as a regular expression. Default false.' },
        case_sensitive: { type: 'boolean', description: 'Default false.' },
        max_results: { type: 'integer', description: 'Cap on matches, 1-200. Default 30.' },
        context_lines: { type: 'integer', description: 'Lines of surrounding context, 0-5. Default 0.' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'edit_document',
    description:
      'PREFERRED EDIT TOOL. Replace an exact substring of the active document. Immune to line drift, '
      + 'and fails loudly rather than editing the wrong place. old_string must match EXACTLY, including '
      + 'whitespace and indentation, and must be unique unless replace_all is true — include 2-3 lines of '
      + 'surrounding context to guarantee uniqueness. Pass an empty new_string to delete.',
    kind: 'doc',
    parameters: {
      type: 'object',
      properties: {
        old_string: { type: 'string', description: 'Exact existing text to replace. Must be unique in the document.' },
        new_string: { type: 'string', description: 'Replacement text. Empty string deletes.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring uniqueness. Default false.' },
      },
      required: ['old_string', 'new_string'],
    },
  },
  {
    name: 'insert_content',
    description: 'Insert a new block of text at a specific line. Use for genuinely new sections; prefer edit_document for changes to existing text.',
    kind: 'doc',
    parameters: {
      type: 'object',
      properties: {
        target_line: { type: 'integer', description: 'Line number, 1-indexed.' },
        position: { type: 'string', enum: ['before', 'after'], description: 'Insert before or after target_line.' },
        text: { type: 'string', description: 'Text block to insert.' },
      },
      required: ['target_line', 'position', 'text'],
    },
  },
  {
    name: 'replace_lines',
    description: 'Replace a continuous block of lines. Use for whole-section rewrites; prefer edit_document for smaller changes.',
    kind: 'doc',
    parameters: {
      type: 'object',
      properties: {
        start_line: { type: 'integer', description: 'First line to replace, 1-indexed inclusive.' },
        end_line: { type: 'integer', description: 'Last line to replace, inclusive.' },
        new_text: { type: 'string', description: 'Replacement text for the whole range.' },
      },
      required: ['start_line', 'end_line', 'new_text'],
    },
  },
];
