import { getDocumentOutline } from './docUtils';
import type { DocMode } from './templates';

// Tier 1 Virtual In-Browser MCP Document Server (MCP_SPEC.md §2)

export interface McpToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface McpToolResult {
  ok: boolean;
  message: string;
  newContent?: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function readDocumentContent(content: string, startLine?: number, endLine?: number): string {
  const lines = content.split('\n');
  const s = startLine ? clamp(startLine, 1, lines.length) : 1;
  const e = endLine ? clamp(endLine, s, lines.length) : lines.length;
  return lines.slice(s - 1, e).join('\n');
}

export function insertContent(
  content: string,
  targetLine: number,
  position: 'before' | 'after',
  text: string,
): McpToolResult {
  const lines = content.split('\n');
  const idx = clamp(targetLine, 1, lines.length + 1);
  const at = position === 'after' ? idx : idx - 1;
  const insertLines = String(text ?? '').split('\n');
  lines.splice(at, 0, ...insertLines);
  return { ok: true, message: `Inserted ${insertLines.length} line(s) at line ${idx} (${position})`, newContent: lines.join('\n') };
}

export function replaceLines(content: string, startLine: number, endLine: number, newText: string): McpToolResult {
  const lines = content.split('\n');
  if (lines.length === 0) return { ok: false, message: 'Empty document' };
  const s = clamp(startLine, 1, lines.length);
  const e = clamp(endLine, s, lines.length);
  lines.splice(s - 1, e - s + 1, ...String(newText ?? '').split('\n'));
  return { ok: true, message: `Replaced lines ${s}-${e}`, newContent: lines.join('\n') };
}

export function executeVirtualTool(content: string, mode: DocMode, call: McpToolCall): McpToolResult & { resultText?: string } {
  const a = call.args ?? {};
  switch (call.name) {
    case 'read_document_content':
    case 'get_document_content': {
      const text = readDocumentContent(content, a.start_line as number | undefined, a.end_line as number | undefined);
      return { ok: true, message: `Read ${text.split('\n').length} line(s)`, resultText: text };
    }
    case 'get_document_outline': {
      const outline = getDocumentOutline(content, mode);
      const text = outline.map((o) => `${'  '.repeat(o.level - 1)}- ${o.title} (line ${o.line})`).join('\n') || '(empty outline)';
      return { ok: true, message: `Outline: ${outline.length} heading(s)`, resultText: text };
    }
    case 'insert_content':
    case 'insert_text': {
      const r = insertContent(content, Number(a.target_line ?? 1), (a.position as 'before' | 'after') ?? 'after', String(a.text ?? ''));
      return r;
    }
    case 'replace_lines': {
      return replaceLines(content, Number(a.start_line ?? 1), Number(a.end_line ?? 1), String(a.new_text ?? ''));
    }
    default:
      return { ok: false, message: `Unknown tool: ${call.name}` };
  }
}

export const VIRTUAL_MCP_TOOL_DEFS = [
  {
    name: 'read_document_content',
    description: 'Reads text lines from the active document to analyze content, structure, or formatting.',
    parameters: {
      type: 'object',
      properties: {
        start_line: { type: 'integer', description: 'Optional starting line (1-indexed). Defaults to 1.' },
        end_line: { type: 'integer', description: 'Optional ending line (inclusive).' },
      },
    },
  },
  {
    name: 'get_document_outline',
    description: 'Returns structural outline (headings #, ##, \\section) with line numbers.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'insert_content',
    description: 'Inserts a block of LaTeX or Markdown text at a specific line.',
    parameters: {
      type: 'object',
      properties: {
        target_line: { type: 'integer', description: 'Line number (1-indexed).' },
        position: { type: 'string', enum: ['before', 'after'] },
        text: { type: 'string', description: 'Text block to insert.' },
      },
      required: ['target_line', 'position', 'text'],
    },
  },
  {
    name: 'replace_lines',
    description: 'Replaces a continuous block of lines with new content.',
    parameters: {
      type: 'object',
      properties: {
        start_line: { type: 'integer' },
        end_line: { type: 'integer' },
        new_text: { type: 'string' },
      },
      required: ['start_line', 'end_line', 'new_text'],
    },
  },
];

export function toolBadge(call: McpToolCall): string {
  if (call.name.includes('read')) return `🛠️ Read lines ${String(call.args.start_line ?? 1)}-${String(call.args.end_line ?? 'end')}`;
  if (call.name.includes('insert')) return `✨ Inserted at line ${String(call.args.target_line ?? '?')}`;
  if (call.name.includes('replace')) return `⚡ Replaced lines ${String(call.args.start_line ?? '?')}-${String(call.args.end_line ?? '?')}`;
  if (call.name.includes('outline')) return '🗂️ Read document outline';
  return `🛠️ ${call.name}`;
}
