import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileAccess } from '../agent/types';
import type { DocMode } from '../templates';
import {
  clearUndoAction,
  createWorkspaceStager,
  describeConflicts,
  findUndoConflicts,
  findWorkspaceConflicts,
  loadUndoAction,
  resolveReviewedWorkspace,
  saveUndoAction,
  workspaceContent,
  type AppliedAiAction,
  type StagedWorkspace,
} from '../aiWorkspace';

interface FakeFile {
  id: string;
  name: string;
  mode: DocMode;
  content: string;
}

function fakeFiles(initial: FakeFile[]) {
  const store = new Map(initial.map((file) => [file.name, { ...file }]));
  const access: FileAccess = {
    list: () => [...store.values()].map((file) => ({
      name: file.name,
      mode: file.mode,
      lines: file.content ? file.content.split('\n').length : 0,
      active: file.name === 'main.md',
    })),
    read: (name) => store.get(name)?.content ?? null,
    write: (name, content) => {
      const file = store.get(name);
      if (!file) return false;
      file.content = content;
      return true;
    },
    create: (name, mode, content) => {
      store.set(name, { id: `new-${name}`, name, mode: mode as DocMode, content });
      return name;
    },
    activeName: () => 'main.md',
    idOf: (name) => store.get(name)?.id ?? null,
  };
  return { access, store };
}

function base() {
  return fakeFiles([
    { id: 'f-main', name: 'main.md', mode: 'markdown', content: '# Main' },
    { id: 'f-paper', name: 'paper.tex', mode: 'latex', content: '\\section{Old}' },
  ]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AI staged workspace', () => {
  it('stages active, cross-file, and created files into one workspace', () => {
    const { access } = base();
    const stager = createWorkspaceStager(access, null, 'main.md');

    stager.stageActive(
      { fileId: 'f-main', name: 'main.md', mode: 'markdown', content: '# Main' },
      '# Main\n\nRewritten',
      'Edited main.md',
    );
    expect(stager.access.write('paper.tex', '\\section{New}')).toBe(true);
    expect(stager.access.create('cover.md', 'markdown', '# Cover')).toBe('cover.md');

    const workspace = stager.workspace();
    expect(workspace.changes).toHaveLength(3);
    expect(workspace.changes.map((change) => [change.name, change.before, change.after])).toEqual([
      ['main.md', '# Main', '# Main\n\nRewritten'],
      ['paper.tex', '\\section{Old}', '\\section{New}'],
      ['cover.md', null, '# Cover'],
    ]);
    expect(workspaceContent(workspace, 'f-main', 'main.md')).toBe('# Main\n\nRewritten');
    expect(stager.access.read('paper.tex')).toBe('\\section{New}');
    expect(stager.access.read('cover.md')).toBe('# Cover');
    expect(stager.access.list().map((file) => file.name)).toContain('cover.md');
  });

  it('keeps the original before text across repeated edits and resumed questions', () => {
    const { access } = base();
    const first = createWorkspaceStager(access, null, 'main.md');
    first.access.write('paper.tex', 'step one');
    const paused = first.workspace();

    const resumed = createWorkspaceStager(access, paused, 'main.md');
    resumed.stageActive(
      { fileId: 'f-main', name: 'main.md', mode: 'markdown', content: '# Main' },
      '# Main\n\nAfter answer',
      'Edited main.md',
    );
    resumed.access.write('paper.tex', 'step two');

    const workspace = resumed.workspace();
    expect(workspace.changes).toHaveLength(2);
    const paper = workspace.changes.find((change) => change.name === 'paper.tex');
    expect(paper?.before).toBe('\\section{Old}');
    expect(paper?.after).toBe('step two');
    expect(workspaceSummaryForTest(workspace)).toContain('Edited main.md');
  });

  it('de-duplicates created names against existing and staged files', () => {
    const { access } = base();
    const stager = createWorkspaceStager(access, null, 'main.md');
    expect(stager.access.create('main.md', 'markdown', 'x')).toBe('main-2.md');
    expect(stager.access.create('main.md', 'markdown', 'y')).toBe('main-3.md');
    expect(stager.access.create('sketch', 'latex', '\\section{Sketch}')).toBe('sketch.tex');
  });

  it('applies only accepted files/chunks and drops reverted changes', () => {
    const { access } = base();
    const stager = createWorkspaceStager(access, null, 'main.md');
    stager.stageActive(
      { fileId: 'f-main', name: 'main.md', mode: 'markdown', content: '# Main' },
      '# Main\n\nAccepted',
      'Edited main.md',
    );
    stager.access.write('paper.tex', '\\section{New}');
    const workspace = stager.workspace();
    const mainKey = workspace.changes.find((change) => change.name === 'main.md')?.key ?? '';
    const paperKey = workspace.changes.find((change) => change.name === 'paper.tex')?.key ?? '';

    const partial = resolveReviewedWorkspace(workspace, {
      [mainKey]: '# Main\n\nAccepted',
      [paperKey]: '\\section{Old}',
    });
    expect(partial.changes.map((change) => change.name)).toEqual(['main.md']);

    const rejected = resolveReviewedWorkspace(workspace, {
      [mainKey]: '# Main',
      [paperKey]: '\\section{Old}',
    });
    expect(rejected.changes).toHaveLength(0);

    const created = createWorkspaceStager(access, null, 'main.md');
    created.access.create('empty.md', 'markdown', 'draft');
    const createdWorkspace = created.workspace();
    const createdKey = createdWorkspace.changes[0].key;
    expect(resolveReviewedWorkspace(createdWorkspace, { [createdKey]: '' }).changes).toHaveLength(0);
  });

  it('detects manual edits, deletions, and new name collisions before apply', () => {
    const files = base();
    const stager = createWorkspaceStager(files.access, null, 'main.md');
    stager.access.write('paper.tex', '\\section{New}');
    stager.access.create('cover.md', 'markdown', 'Cover');
    const workspace = stager.workspace();

    files.store.get('paper.tex')!.content = '\\section{Manual}';
    files.store.set('cover.md', { id: 'manual', name: 'cover.md', mode: 'markdown', content: 'Manual' });
    const targets = [...files.store.values()];
    const conflicts = findWorkspaceConflicts(workspace, targets);
    expect(conflicts.map((conflict) => conflict.reason)).toEqual(['changed', 'name-taken']);
    expect(describeConflicts(conflicts)).toMatch(/changed outside this action/);
    expect(describeConflicts(conflicts)).toMatch(/already exists/);

    files.store.delete('paper.tex');
    expect(findWorkspaceConflicts(workspace, [...files.store.values()])).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'paper.tex', reason: 'missing' })]),
    );
  });

  it('blocks undo when a file changed, but treats an already-removed created file as undone', () => {
    const action: AppliedAiAction = {
      id: 'a1',
      createdAt: 1,
      summary: 'Two files',
      files: [
        { created: false, fileId: 'f-main', name: 'main.md', mode: 'markdown', before: '# Main', after: '# Main v2' },
        { created: true, fileId: 'f-cover', name: 'cover.md', mode: 'markdown', before: null, after: 'Cover' },
      ],
    };

    const files = base();
    files.store.get('main.md')!.content = '# Main v2';
    files.store.set('cover.md', { id: 'f-cover', name: 'cover.md', mode: 'markdown', content: 'Cover' });
    expect(findUndoConflicts(action, [...files.store.values()])).toHaveLength(0);

    files.store.get('main.md')!.content = '# Manual edit';
    files.store.get('cover.md')!.content = 'Edited cover';
    const conflicts = findUndoConflicts(action, [...files.store.values()]);
    expect(conflicts.map((conflict) => conflict.name)).toEqual(['main.md', 'cover.md']);

    files.store.delete('cover.md');
    expect(findUndoConflicts(action, [...files.store.values()])).toEqual([
      expect.objectContaining({ name: 'main.md', reason: 'changed' }),
    ]);
  });

  it('persists the complete applied action across a reload and reports storage failures', () => {
    const memory = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
      removeItem: (key: string) => { memory.delete(key); },
    });

    const action: AppliedAiAction = {
      id: 'reload',
      createdAt: 42,
      summary: 'Rewrote main and created cover',
      files: [
        { created: false, fileId: 'f-main', name: 'main.md', mode: 'markdown', before: '# Main', after: '# Main v2' },
        { created: true, fileId: 'f-cover', name: 'cover.md', mode: 'markdown', before: null, after: 'Cover' },
      ],
    };
    expect(saveUndoAction(action)).toEqual({ ok: true });
    expect(loadUndoAction()).toEqual(action);
    clearUndoAction();
    expect(loadUndoAction()).toBeNull();

    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('Quota exceeded'); },
      removeItem: () => {},
    });
    expect(saveUndoAction(action)).toEqual({ ok: false, error: 'Quota exceeded' });
  });

  it('starts with no staged work after cancellation', () => {
    const { access } = base();
    const stager = createWorkspaceStager(access, null, 'main.md');
    expect(stager.workspace().changes).toHaveLength(0);
    expect(findWorkspaceConflicts(stager.workspace(), [])).toHaveLength(0);
  });
});

function workspaceSummaryForTest(workspace: StagedWorkspace): string {
  return workspace.changes.flatMap((change) => change.labels).join(' | ');
}
