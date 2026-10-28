import { describe, expect, it } from 'vitest';
import { projectFileToRow, rowToProjectFile, utf8Bytes } from './mapping';

describe('cloud file mapping', () => {
  it('maps a local file to a cloud row', () => {
    const row = projectFileToRow(
      { id: 'f_1', name: 'paper.tex', mode: 'latex', content: '\\section{Intro}', updatedAt: 1 },
      'project-1',
    );
    expect(row).toEqual({
      project_id: 'project-1',
      path: 'paper.tex',
      content: '\\section{Intro}',
      mode: 'latex',
    });
  });

  it('derives the editor mode from the path on the way back', () => {
    const file = rowToProjectFile({
      id: 'file-1',
      path: 'notes.md',
      content: '# Notes',
      mode: 'markdown',
      version: 3,
      updated_at: '2026-01-02T03:04:05.000Z',
    });
    expect(file.id).toBe('file-1');
    expect(file.name).toBe('notes.md');
    expect(file.mode).toBe('markdown');
    expect(file.content).toBe('# Notes');
    expect(file.updatedAt).toBe(Date.parse('2026-01-02T03:04:05.000Z'));
  });

  it('maps .bib files to the plain markdown editor', () => {
    const file = rowToProjectFile({
      id: 'file-2',
      path: 'refs.bib',
      content: '@article{a}',
      mode: 'markdown',
      version: 1,
      updated_at: new Date().toISOString(),
    });
    expect(file.mode).toBe('markdown');
  });

  it('counts UTF-8 bytes rather than characters', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('é')).toBe(2);
    expect(utf8Bytes('日本語')).toBe(9);
  });
});
