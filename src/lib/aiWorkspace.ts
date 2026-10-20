import type { FileAccess } from './agent/types';
import { extForMode, modeForName } from './projectFiles';
import type { DocMode } from './templates';

export interface WorkspaceFileChange {
  key: string;
  fileId: string | null;
  name: string;
  mode: DocMode;
  before: string | null;
  after: string;
  labels: string[];
}

export interface StagedWorkspace {
  id: string;
  startedAt: number;
  changes: WorkspaceFileChange[];
  activeName?: string;
}

export interface ActiveWorkspaceTarget {
  fileId: string | null;
  name: string;
  mode: DocMode;
  content: string;
}

export interface WorkspaceTarget {
  id: string;
  name: string;
  mode: DocMode;
  content: string;
}

export type WorkspaceConflictReason = 'missing' | 'changed' | 'name-taken';

export interface WorkspaceConflict {
  key: string;
  name: string;
  reason: WorkspaceConflictReason;
}

export interface AppliedWorkspaceFile {
  created: boolean;
  fileId: string;
  name: string;
  mode: DocMode;
  before: string | null;
  after: string;
}

export interface AppliedAiAction {
  id: string;
  createdAt: number;
  summary: string;
  files: AppliedWorkspaceFile[];
  previousActiveId?: string;
}

export type WorkspaceApplyResult =
  | { ok: true; action: AppliedAiAction }
  | { ok: false; conflicts: WorkspaceConflict[] };

export type UndoStorageResult = { ok: true } | { ok: false; error: string };

const LS_UNDO = 'dexter-write:ai-undo:v1';

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function keyFor(fileId: string | null, name: string): string {
  return fileId ? `id:${fileId}` : `name:${name}`;
}

function isDocMode(value: unknown): value is DocMode {
  return value === 'markdown' || value === 'latex' || value === 'typst';
}

export function createWorkspace(): StagedWorkspace {
  return { id: uid('ws'), startedAt: Date.now(), changes: [] };
}

export function stageChange(
  workspace: StagedWorkspace,
  input: {
    fileId: string | null;
    name: string;
    mode: DocMode;
    before: string | null;
    after: string;
    label: string;
  },
): StagedWorkspace {
  const key = keyFor(input.fileId, input.name);
  const existing = workspace.changes.find((change) => change.key === key);
  let changes: WorkspaceFileChange[];

  if (existing) {
    const before = existing.before;
    if (before !== null && before === input.after) {
      changes = workspace.changes.filter((change) => change.key !== key);
    } else {
      changes = workspace.changes.map((change) => (
        change.key === key
          ? {
              ...change,
              name: input.name,
              mode: input.mode,
              after: input.after,
              labels: change.labels.includes(input.label)
                ? change.labels
                : [...change.labels, input.label],
            }
          : change
      ));
    }
  } else if (input.before !== null && input.before === input.after) {
    changes = workspace.changes;
  } else {
    changes = [
      ...workspace.changes,
      {
        key,
        fileId: input.fileId,
        name: input.name,
        mode: input.mode,
        before: input.before,
        after: input.after,
        labels: [input.label],
      },
    ];
  }

  return { ...workspace, changes };
}

export function workspaceContent(
  workspace: StagedWorkspace | null,
  fileId: string | null,
  name: string,
): string | undefined {
  if (!workspace) return undefined;
  const key = keyFor(fileId, name);
  return workspace.changes.find((change) => change.key === key)?.after;
}

export function workspaceSummary(workspace: StagedWorkspace): string {
  const labels: string[] = [];
  for (const change of workspace.changes) {
    for (const label of change.labels) {
      if (!labels.includes(label)) labels.push(label);
    }
  }
  if (labels.length === 0) {
    return `${workspace.changes.length} staged file${workspace.changes.length === 1 ? '' : 's'}`;
  }
  const shown = labels.slice(0, 3).join(' · ');
  return labels.length > 3 ? `${shown} · +${labels.length - 3} more` : shown;
}

export function resolveReviewedWorkspace(
  workspace: StagedWorkspace,
  contents: Record<string, string>,
): StagedWorkspace {
  const changes: WorkspaceFileChange[] = [];
  for (const change of workspace.changes) {
    const reviewed = contents[change.key];
    const after = reviewed === undefined ? change.after : reviewed;
    if (change.before !== null && after === change.before) continue;
    if (change.before === null && after === '') continue;
    changes.push({ ...change, after });
  }
  return { ...workspace, changes };
}

function findTarget(
  files: WorkspaceTarget[],
  fileId: string | null,
  name: string,
): WorkspaceTarget | null {
  if (fileId) return files.find((file) => file.id === fileId) ?? null;
  return files.find((file) => file.name === name) ?? null;
}

export function findWorkspaceConflicts(
  workspace: StagedWorkspace,
  files: WorkspaceTarget[],
): WorkspaceConflict[] {
  const conflicts: WorkspaceConflict[] = [];
  for (const change of workspace.changes) {
    if (change.before === null) {
      if (files.some((file) => file.name === change.name)) {
        conflicts.push({ key: change.key, name: change.name, reason: 'name-taken' });
      }
      continue;
    }
    const target = findTarget(files, change.fileId, change.name);
    if (!target) {
      conflicts.push({ key: change.key, name: change.name, reason: 'missing' });
    } else if (target.content !== change.before || target.name !== change.name || target.mode !== change.mode) {
      conflicts.push({ key: change.key, name: change.name, reason: 'changed' });
    }
  }
  return conflicts;
}

export function findUndoConflicts(
  action: AppliedAiAction,
  files: WorkspaceTarget[],
): WorkspaceConflict[] {
  const conflicts: WorkspaceConflict[] = [];
  for (const file of action.files) {
    const target = findTarget(files, file.fileId, file.name);
    if (file.created) {
      if (target && (target.content !== file.after || target.name !== file.name || target.mode !== file.mode)) {
        conflicts.push({ key: file.fileId, name: file.name, reason: 'changed' });
      }
      continue;
    }
    if (!target) {
      conflicts.push({ key: file.fileId, name: file.name, reason: 'missing' });
    } else if (target.content !== file.after || target.name !== file.name || target.mode !== file.mode) {
      conflicts.push({ key: file.fileId, name: file.name, reason: 'changed' });
    }
  }
  return conflicts;
}

export function describeConflicts(conflicts: WorkspaceConflict[]): string {
  return conflicts
    .map((conflict) => {
      if (conflict.reason === 'missing') return `${conflict.name} was deleted or renamed`;
      if (conflict.reason === 'name-taken') return `${conflict.name} already exists now`;
      return `${conflict.name} changed outside this action`;
    })
    .join('; ');
}

function uniqueStagedName(base: FileAccess, workspace: StagedWorkspace, requested: string): string {
  const names = new Set(base.list().map((file) => file.name));
  for (const change of workspace.changes) {
    if (change.before === null) names.add(change.name);
  }
  if (!names.has(requested)) return requested;
  const dot = requested.lastIndexOf('.');
  const stem = dot > 0 ? requested.slice(0, dot) : requested;
  const ext = dot > 0 ? requested.slice(dot) : '';
  let index = 2;
  while (names.has(`${stem}-${index}${ext}`)) index += 1;
  return `${stem}-${index}${ext}`;
}

export interface WorkspaceStager {
  workspace: () => StagedWorkspace;
  access: FileAccess;
  stageActive: (target: ActiveWorkspaceTarget, after: string, label: string) => StagedWorkspace;
}

export function createWorkspaceStager(
  source: FileAccess,
  initial: StagedWorkspace | null,
  turnActiveName?: string,
): WorkspaceStager {
  const rows = source.list().map((row) => ({ ...row }));
  const contents = new Map(rows.map((row) => [row.name, source.read(row.name)]));
  const ids = new Map(rows.map((row) => [row.name, source.idOf?.(row.name) ?? null]));
  const base: FileAccess = {
    list: () => rows, read: (name) => contents.get(name) ?? null,
    idOf: (name) => ids.get(name) ?? null, activeName: () => source.activeName(),
    write: () => false, create: () => null,
  };
  let workspace = initial ?? createWorkspace();
  let activeName = initial?.activeName ?? turnActiveName ?? base.activeName();

  const changeByName = (name: string): WorkspaceFileChange | undefined => (
    workspace.changes.find((change) => change.name === name)
  );

  const access: FileAccess = {
    list: () => {
      const rows = base.list();
      const seen = new Set(rows.map((row) => row.name));
      const out = rows.map((row) => {
        const change = changeByName(row.name);
        if (!change) return { ...row, active: row.name === activeName };
        const content = change.after;
        return {
          name: change.name,
          mode: change.mode,
          lines: content ? content.split('\n').length : 0,
          active: change.name === activeName,
        };
      });
      for (const change of workspace.changes) {
        if (change.before !== null || seen.has(change.name)) continue;
        out.push({
          name: change.name,
          mode: change.mode,
          lines: change.after ? change.after.split('\n').length : 0,
          active: change.name === activeName,
        });
      }
      return out;
    },
    read: (name) => {
      const change = changeByName(name);
      return change ? change.after : base.read(name);
    },
    write: (name, content) => {
      const change = changeByName(name);
      const baseContent = base.read(name);
      if (!change && baseContent === null) return false;
      const fileId = change?.fileId ?? base.idOf?.(name) ?? null;
      const before = change ? change.before : baseContent;
      workspace = stageChange(workspace, {
        fileId,
        name,
        mode: change?.mode ?? modeForName(name),
        before,
        after: content,
        label: `Edited ${name}`,
      });
      return true;
    },
    create: (name, mode, content) => {
      const withExt = name.includes('.') ? name : `${name}.${extForMode(mode as DocMode)}`;
      const finalName = uniqueStagedName(base, workspace, withExt);
      workspace = stageChange(workspace, {
        fileId: null,
        name: finalName,
        mode: modeForName(finalName),
        before: null,
        after: content,
        label: `Created ${finalName}`,
      });
      return finalName;
    },
    activeName: () => activeName,
    setActive: (name) => {
      if (access.read(name) === null) return false;
      activeName = name;
      workspace = { ...workspace, activeName: name };
      return true;
    },
    idOf: (name) => base.idOf?.(name) ?? null,
  };

  return {
    workspace: () => workspace,
    access,
    stageActive: (target, after, label) => {
      const existing = workspace.changes.find((change) => (
        target.fileId
          ? change.fileId === target.fileId
          : change.name === target.name && change.fileId === null
      ));
      workspace = stageChange(workspace, {
        fileId: target.fileId,
        name: target.name,
        mode: target.mode,
        before: existing ? existing.before : target.content,
        after,
        label,
      });
      return workspace;
    },
  };
}

export function loadUndoAction(): AppliedAiAction | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LS_UNDO);
    if (!raw) return null;
    return parseUndoAction(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveUndoAction(action: AppliedAiAction): UndoStorageResult {
  try {
    if (typeof localStorage === 'undefined') {
      return { ok: false, error: 'localStorage is unavailable' };
    }
    localStorage.setItem(LS_UNDO, JSON.stringify(action));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function clearUndoAction(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_UNDO);
  } catch {
    /* storage disabled */
  }
}

function parseUndoAction(raw: unknown): AppliedAiAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || typeof value.summary !== 'string') return null;
  if (typeof value.createdAt !== 'number' || !Array.isArray(value.files)) return null;
  const files: AppliedWorkspaceFile[] = [];
  for (const item of value.files) {
    if (!item || typeof item !== 'object') return null;
    const file = item as Record<string, unknown>;
    if (typeof file.created !== 'boolean') return null;
    if (typeof file.fileId !== 'string' || typeof file.name !== 'string') return null;
    if (!isDocMode(file.mode) || typeof file.after !== 'string') return null;
    if (file.before !== null && typeof file.before !== 'string') return null;
    if (file.created && file.before !== null) return null;
    if (!file.created && typeof file.before !== 'string') return null;
    files.push({
      created: file.created,
      fileId: file.fileId,
      name: file.name,
      mode: file.mode,
      before: file.before as string | null,
      after: file.after,
    });
  }
  return {
    id: value.id,
    createdAt: value.createdAt,
    summary: value.summary,
    files,
    previousActiveId: typeof value.previousActiveId === 'string' ? value.previousActiveId : undefined,
  };
}
