import { applyStringEdit } from '../agent/tools/document';
import { insertContent, validateDocEdit } from '../virtualMcp';
import { stageChange, type StagedWorkspace } from '../aiWorkspace';
import type { DocMode } from '../templates';

export interface ExternalTargetFile {
  id: string;
  name: string;
  mode: DocMode;
  content: string;
}

export type ExternalEditResult =
  | { ok: true; workspace: StagedWorkspace; name: string; message: string; files: number }
  | { ok: false; message: string };

function stringArg(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? args[key].trim() : '';
}

export function resolveExternalTarget(
  files: ExternalTargetFile[],
  activeId: string,
  args: Record<string, unknown>,
): ExternalTargetFile | null {
  const fileId = stringArg(args, 'file_id');
  const filename = stringArg(args, 'filename');
  if (fileId) return files.find((file) => file.id === fileId) ?? null;
  if (filename) return files.find((file) => file.name === filename) ?? null;
  return files.find((file) => file.id === activeId) ?? files[0] ?? null;
}

function stagedBase(
  workspace: StagedWorkspace,
  target: ExternalTargetFile,
): { ok: true; content: string } | { ok: false; message: string } {
  const staged = workspace.changes.find((change) => (
    target.id ? change.fileId === target.id : change.name === target.name
  ));
  if (!staged) return { ok: true, content: target.content };
  if (staged.before !== null && staged.before !== target.content) {
    return {
      ok: false,
      message: `${target.name} changed after it was staged. Review or discard the pending external workspace before staging another edit to this file.`,
    };
  }
  return { ok: true, content: staged.after };
}

function labelFor(args: Record<string, unknown>, fallback: string): string {
  const explanation = stringArg(args, 'explanation');
  if (!explanation) return `External: ${fallback}`;
  return `External: ${explanation.slice(0, 80)}`;
}

function success(
  workspace: StagedWorkspace,
  name: string,
  message: string,
): ExternalEditResult {
  return { ok: true, workspace, name, files: workspace.changes.length, message };
}

export function stageExternalStringEdit(
  workspace: StagedWorkspace,
  target: ExternalTargetFile,
  args: Record<string, unknown>,
): ExternalEditResult {
  const base = stagedBase(workspace, target);
  if (!base.ok) return base;
  const result = applyStringEdit(base.content, args, 'dexter_stage_edit');
  if (result.isError || result.newContent === undefined) {
    return { ok: false, message: result.content };
  }
  const next = stageChange(workspace, {
    fileId: target.id || null,
    name: target.name,
    mode: target.mode,
    before: target.content,
    after: result.newContent,
    label: labelFor(args, `edit ${target.name}`),
  });
  return success(
    next,
    target.name,
    `${result.content} Staged for review in Dexter Write; nothing has been applied yet.`,
  );
}

export function stageExternalInsertion(
  workspace: StagedWorkspace,
  target: ExternalTargetFile,
  args: Record<string, unknown>,
): ExternalEditResult {
  const base = stagedBase(workspace, target);
  if (!base.ok) return base;
  const content = typeof args.content === 'string' ? args.content : '';
  const position = args.position === 'before' ? 'before' : 'after';
  const line = Number(args.target_line);
  if (!Number.isInteger(line)) {
    return { ok: false, message: 'dexter_insert_content needs an integer target_line.' };
  }
  const problem = validateDocEdit(base.content, {
    name: 'insert_content',
    args: { ...args, target_line: line, text: content },
  });
  if (problem) return { ok: false, message: problem };
  const inserted = insertContent(base.content, line, position, content);
  if (!inserted.ok || inserted.newContent === undefined) {
    return { ok: false, message: inserted.message };
  }
  const next = stageChange(workspace, {
    fileId: target.id || null,
    name: target.name,
    mode: target.mode,
    before: target.content,
    after: inserted.newContent,
    label: labelFor(args, `insert into ${target.name}`),
  });
  return success(
    next,
    target.name,
    `${inserted.message}. Staged for review in Dexter Write; nothing has been applied yet.`,
  );
}
