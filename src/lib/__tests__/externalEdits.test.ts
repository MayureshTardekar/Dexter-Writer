import { describe, it, expect } from 'vitest';
import { createWorkspace } from '../aiWorkspace';
import {
  resolveExternalTarget,
  stageExternalInsertion,
  stageExternalStringEdit,
  type ExternalTargetFile,
} from '../mcp/externalEdits';

const main: ExternalTargetFile = {
  id: 'file_main',
  name: 'main.md',
  mode: 'markdown',
  content: '# Title\nAlpha\nGamma',
};

describe('external MCP staging', () => {
  it('resolves targets by id, name, and active fallback', () => {
    const files = [
      main,
      { id: 'file_refs', name: 'refs.tex', mode: 'latex' as const, content: '@article{one}' },
    ];
    expect(resolveExternalTarget(files, 'file_main', { filename: 'refs.tex' })?.id).toBe('file_refs');
    expect(resolveExternalTarget(files, 'file_main', { file_id: 'file_main' })?.name).toBe('main.md');
    expect(resolveExternalTarget(files, 'file_refs', {})?.name).toBe('refs.tex');
    expect(resolveExternalTarget(files, 'missing', { filename: 'nope.md' })).toBeNull();
  });

  it('stages an exact-string edit without touching the project file', () => {
    const result = stageExternalStringEdit(createWorkspace(), main, {
      old_string: 'Alpha',
      new_string: 'Beta',
      explanation: 'rename section',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toBe(1);
    expect(result.workspace.changes).toHaveLength(1);
    expect(result.workspace.changes[0].before).toBe(main.content);
    expect(result.workspace.changes[0].after).toBe('# Title\nBeta\nGamma');
    expect(result.workspace.changes[0].labels.join(' ')).toContain('External');
    expect(result.workspace.changes[0].labels.join(' ')).toContain('rename section');
    expect(main.content).toBe('# Title\nAlpha\nGamma');
  });

  it('stacks edits on the staged content and rejects stale bases', () => {
    const first = stageExternalStringEdit(createWorkspace(), main, {
      old_string: '# Title',
      new_string: '# Better title',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = stageExternalStringEdit(first.workspace, main, {
      old_string: 'Alpha',
      new_string: 'Beta',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.workspace.changes).toHaveLength(1);
    expect(second.workspace.changes[0].after).toBe('# Better title\nBeta\nGamma');

    const editedElsewhere = { ...main, content: '# Title\nAlpha changed\nGamma' };
    const stale = stageExternalStringEdit(second.workspace, editedElsewhere, {
      old_string: 'Gamma',
      new_string: 'Delta',
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.message).toContain('changed after it was staged');
  });

  it('reports duplicate matches and refuses empty insertions', () => {
    const duplicate = stageExternalStringEdit(createWorkspace(), {
      ...main,
      content: 'Alpha\nAlpha',
    }, {
      old_string: 'Alpha',
      new_string: 'Beta',
    });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.message.toLowerCase()).toContain('matched 2 times');

    const empty = stageExternalInsertion(createWorkspace(), main, {
      target_line: 2,
      position: 'after',
      content: '   ',
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.message).toContain('empty text');
  });

  it('stages line insertions before and after the target line', () => {
    const after = stageExternalInsertion(createWorkspace(), main, {
      target_line: 2,
      position: 'after',
      content: 'Beta',
    });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.workspace.changes[0].after).toBe('# Title\nAlpha\nBeta\nGamma');

    const before = stageExternalInsertion(createWorkspace(), main, {
      target_line: 1,
      position: 'before',
      content: '---',
    });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.workspace.changes[0].after).toBe('---\n# Title\nAlpha\nGamma');
  });

  it('inserts into an empty document', () => {
    const emptyFile: ExternalTargetFile = { id: 'new', name: 'new.md', mode: 'markdown', content: '' };
    const result = stageExternalInsertion(createWorkspace(), emptyFile, {
      target_line: 1,
      position: 'after',
      content: '# Hello\nWorld',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.workspace.changes[0].after).toBe('# Hello\nWorld');
  });
});
