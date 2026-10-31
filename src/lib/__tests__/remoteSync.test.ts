import { describe, expect, it } from 'vitest';
import { changedFiles, contentHash, makeBaseline, matchesBaseline } from '../cloud/remoteSync';

const meta = (path: string, version: number) => ({
  id: `id-${path}`,
  path,
  version,
  updatedAt: '2026-10-30T00:00:00.000Z',
});

describe('cloud remote sync', () => {
  it('hashes content deterministically', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'));
    expect(contentHash('hello')).not.toBe(contentHash('hello!'));
  });

  it('builds a baseline only for files that exist locally', () => {
    const baseline = makeBaseline(
      [meta('main.md', 3), meta('cloud-only.md', 1)],
      [{ name: 'main.md', content: 'hello' }],
    );
    expect(Object.keys(baseline)).toEqual(['main.md']);
    expect(baseline['main.md'].version).toBe(3);
    expect(baseline['main.md'].hash).toBe(contentHash('hello'));
  });

  it('reports new files and version bumps', () => {
    const baseline = makeBaseline([meta('main.md', 3)], [{ name: 'main.md', content: 'hello' }]);
    expect(changedFiles([meta('main.md', 3)], baseline)).toHaveLength(0);
    expect(changedFiles([meta('main.md', 4)], baseline).map((file) => file.path)).toEqual(['main.md']);
    expect(changedFiles([meta('main.md', 3), meta('new.md', 1)], baseline).map((file) => file.path)).toEqual(['new.md']);
  });

  it('detects a clean local copy against the baseline hash', () => {
    const baseline = makeBaseline([meta('main.md', 3)], [{ name: 'main.md', content: 'hello' }]);
    expect(matchesBaseline('hello', baseline['main.md'])).toBe(true);
    expect(matchesBaseline('changed locally', baseline['main.md'])).toBe(false);
    expect(matchesBaseline('hello', undefined)).toBe(false);
  });
});
