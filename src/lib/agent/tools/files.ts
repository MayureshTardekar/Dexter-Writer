import { projectPath } from '../../projectPaths';
import type { FileAccess, ToolCall, ToolDef } from '../types';
import type { ToolOutcome } from './document';
import { applyStringEdit } from './document';

/**
 * Tools that reach across the whole project rather than just the active file.
 *
 * `projectFiles.ts` has modelled a multi-file project all along, but the AI
 * only ever saw the active tab (AI_AGENT_ROADMAP.md §2 P6). These tools close
 * that gap through the {@link FileAccess} port, which `App.tsx` implements over
 * its `files` / `setFiles` state — the engine never imports React.
 *
 * Writes go through the caller's FileAccess port. The chat caller supplies a
 * staged overlay, so create/edit operations join the active document in one
 * review workspace instead of touching project files immediately.
 */

export const FILE_TOOL_NAMES = new Set(['list_files', 'read_file', 'create_file', 'edit_file']);

const MAX_FILE_READ_CHARS = 6000;
const MAX_CREATE_CHARS = 100_000;
const VALID_MODES = new Set(['markdown', 'latex', 'typst']);

function nameProblem(name: string): string | null {
  if (!name) return 'name is required.';
  if (/\.(png|jpe?g|webp|gif|svg|pdf|zip)$/i.test(name)) return 'Use the image library or import controls for binary files; this tool writes text only.';
  try { projectPath(name); } catch (e) { return String(e); }
  if (name.length > 120) return `invalid name — too long (${name.length} chars).`;
  return null;
}

function modeForExt(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tex')) return 'latex';
  if (lower.endsWith('.typ')) return 'typst';
  return 'markdown';
}

/** Human-readable project listing, also used to seed the system prompt. */
export function renderFileList(files: FileAccess): string {
  const rows = files.list();
  if (rows.length === 0) return '(no files)';
  return rows
    .map((f) => `- ${f.name} (${f.mode}, ${f.lines} lines)${f.active ? '  ← ACTIVE FILE' : ''}`)
    .join('\n');
}

function missingFile(files: FileAccess, name: string): ToolOutcome {
  const names = files.list().map((f) => f.name).join(', ');
  return { content: `No file named "${name}". Files in this project: ${names || '(none)'}.`, isError: true };
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

export function executeFileTool(files: FileAccess, call: ToolCall): ToolOutcome {
  const a = call.args ?? {};

  switch (call.name) {
    case 'list_files':
      return { content: renderFileList(files), badge: '📁 Listed project files' };

    case 'read_file': {
      const name = String(a.name ?? '');
      const problem = nameProblem(name);
      if (problem) return { content: `read_file failed: ${problem}`, isError: true };
      const content = files.read(name);
      if (content === null) return missingFile(files, name);
      if (!content) return { content: `"${name}" is empty.`, badge: `📄 Read ${name}` };

      const lines = content.split('\n');
      const start = a.start_line === undefined ? 1 : clampInt(a.start_line, 1, lines.length, 1);
      const end = a.end_line === undefined ? lines.length : clampInt(a.end_line, start, lines.length, lines.length);
      const numbered = lines
        .slice(start - 1, end)
        .map((l, i) => `${start + i}: ${l}`)
        .join('\n');
      const body = numbered.length > MAX_FILE_READ_CHARS
        ? `${numbered.slice(0, MAX_FILE_READ_CHARS)}\n… [truncated — request a narrower line range]`
        : numbered;
      return { content: `${name} (lines ${start}-${end} of ${lines.length}):\n${body}`, badge: `📄 Read ${name}` };
    }

    case 'create_file': {
      const name = String(a.name ?? '');
      const problem = nameProblem(name);
      if (problem) return { content: `create_file failed: ${problem}`, isError: true };
      const content = String(a.content ?? '');
      if (content.length > MAX_CREATE_CHARS) {
        return { content: `create_file failed: content is ${content.length} chars, over the ${MAX_CREATE_CHARS} limit.`, isError: true };
      }
      const requested = String(a.mode ?? '').toLowerCase();
      const mode = VALID_MODES.has(requested) ? requested : modeForExt(name);
      const finalName = files.create(name, mode, content);
      if (!finalName) return { content: `create_file failed: could not create "${name}".`, isError: true };
      const renamed = finalName !== name
        ? ` NOTE: renamed to "${finalName}" to avoid a name collision — refer to it as "${finalName}" from now on.`
        : '';
      return {
        content: `Staged creation of "${finalName}" (${mode}, ${content.split('\n').length} lines) for review. Use edit_file to refine it before the user applies the workspace.${renamed}`,
        badge: `📁 Staged ${finalName}`,
      };
    }

    case 'edit_file': {
      const name = String(a.name ?? '');
      const problem = nameProblem(name);
      if (problem) return { content: `edit_file failed: ${problem}`, isError: true };
      // The active document has its own tool, which keeps the turn's staged
      // content coherent. Routing the active file through here would bypass
      // the active-document tool result and be clobbered by a later edit.
      if (name === files.activeName()) {
        return {
          content: `edit_file cannot target "${name}" because it is the ACTIVE document. Use edit_document instead.`,
          isError: true,
        };
      }
      const content = files.read(name);
      if (content === null) return missingFile(files, name);

      const outcome = applyStringEdit(content, a, `edit_file("${name}")`);
      if (outcome.isError || outcome.newContent === undefined) return outcome;

      const ok = files.write(name, outcome.newContent);
      if (!ok) return { content: `edit_file failed: could not write "${name}".`, isError: true };
      return {
        // Deliberately drop newContent: this edited another file, not the
        // active document. The caller's staged FileAccess overlay records it.
        content: `${outcome.content} Staged for review in "${name}".`,
        badge: `✏️ Staged ${name}`,
      };
    }

    default:
      return { content: `Unknown file tool: ${call.name}`, isError: true };
  }
}

export const FILE_TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_files',
    description: 'List every file in this project with its format and line count. Cheap — call it before working across files.',
    kind: 'read',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'read_file',
    description: 'Read a file in this project other than the active one, line-numbered. Use it to match terminology, structure or style across documents.',
    kind: 'read',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact file name as shown by list_files, e.g. "paper.tex".' },
        start_line: { type: 'integer', description: 'Starting line, 1-indexed. Defaults to 1.' },
        end_line: { type: 'integer', description: 'Ending line, inclusive.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_file',
    description: 'Stage a new file in the project for the same review as all other AI edits. Use relative project paths; folders are supported. The extension sets the format (.md, .tex, .typ).',
    kind: 'file',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'File name with extension, e.g. "cover-letter.md".' },
        mode: { type: 'string', enum: ['markdown', 'latex', 'typst'], description: 'Format. Inferred from the extension when omitted.' },
        content: { type: 'string', description: 'Initial content.' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Exact-string replace in a NON-ACTIVE project file. Same matching rules as edit_document: old_string '
      + 'must match exactly and uniquely. Staged for one review with all other AI edits.',
    kind: 'file',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exact file name as shown by list_files.' },
        old_string: { type: 'string', description: 'Exact existing text to replace. Must be unique in that file.' },
        new_string: { type: 'string', description: 'Replacement text. Empty string deletes.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence. Default false.' },
      },
      required: ['name', 'old_string', 'new_string'],
    },
  },
];
