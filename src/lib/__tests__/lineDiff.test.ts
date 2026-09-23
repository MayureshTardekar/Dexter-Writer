import { describe, it, expect } from 'vitest';
import { computeHunks } from '../lineDiff';

describe('Line Diff Engine', () => {
  it('returns empty or equal hunks for identical content', () => {
    const text = 'Line 1\nLine 2\nLine 3';
    const hunks = computeHunks(text, text);
    // Identical content has no net diff modifications
    const nonEqual = hunks.filter((h) => h.kind !== 'equal');
    expect(nonEqual.length).toBe(0);
  });

  it('detects a single line replacement', () => {
    const before = 'Line 1\nOld Line 2\nLine 3';
    const after = 'Line 1\nNew Line 2\nLine 3';
    const hunks = computeHunks(before, after);
    expect(hunks.length).toBeGreaterThan(0);
    const modHunk = hunks.find((h) => h.kind === 'replace');
    expect(modHunk).toBeDefined();
    expect(modHunk?.origLines).toContain('Old Line 2');
    expect(modHunk?.newLines).toContain('New Line 2');
  });

  it('detects inserted lines', () => {
    const before = 'Line 1\nLine 2';
    const after = 'Line 1\nLine 1.5\nLine 2';
    const hunks = computeHunks(before, after);
    const insertHunk = hunks.find((h) => h.kind === 'insert' || h.kind === 'replace');
    expect(insertHunk).toBeDefined();
    expect(insertHunk?.newLines).toContain('Line 1.5');
  });

  it('detects deleted lines', () => {
    const before = 'Line 1\nTo Be Deleted\nLine 2';
    const after = 'Line 1\nLine 2';
    const hunks = computeHunks(before, after);
    const deleteHunk = hunks.find((h) => h.kind === 'delete' || h.kind === 'replace');
    expect(deleteHunk).toBeDefined();
    expect(deleteHunk?.origLines).toContain('To Be Deleted');
  });
});
