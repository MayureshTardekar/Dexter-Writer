import { describe, it, expect } from 'vitest';
import { resolveExportFilename } from '../exportDoc';

describe('resolveExportFilename', () => {
  it('derives export filenames from active document name', () => {
    expect(resolveExportFilename('pdf', 'mayuresh.tex')).toBe('mayuresh.pdf');
    expect(resolveExportFilename('tex', 'mayuresh.tex')).toBe('mayuresh.tex');
    expect(resolveExportFilename('md', 'notes.md')).toBe('notes.md');
    expect(resolveExportFilename('typ', 'report.typ')).toBe('report.typ');
    expect(resolveExportFilename('typst-pdf', 'cv.typ')).toBe('cv.pdf');
    expect(resolveExportFilename('html', 'resume.md')).toBe('resume.html');
    expect(resolveExportFilename('txt', 'assignment.tex')).toBe('assignment.txt');
  });

  it('handles filenames with multiple dots or subpaths safely', () => {
    expect(resolveExportFilename('pdf', 'john.doe.resume.tex')).toBe('john.doe.resume.pdf');
    expect(resolveExportFilename('tex', 'chapter-1.tex')).toBe('chapter-1.tex');
  });

  it('falls back to document-timestamp when no docName is provided', () => {
    const stamp = '2026-10-03';
    expect(resolveExportFilename('pdf', undefined, stamp)).toBe('document-2026-10-03.pdf');
    expect(resolveExportFilename('tex', '', stamp)).toBe('document-2026-10-03.tex');
    expect(resolveExportFilename('zip', undefined, stamp)).toBe('dexter-write-project-2026-10-03.zip');
  });
});
