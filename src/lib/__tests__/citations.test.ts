import { describe, it, expect } from 'vitest';
import { parseBibTeX, formatBibTeX } from '../citations';

describe('Citations & BibTeX Engine', () => {
  const sampleBibTeX = `
@article{vaswani2017attention,
  title={Attention is all you need},
  author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob},
  journal={Advances in neural information processing systems},
  year={2017},
  doi={10.5555/3295222.3295349}
}

@book{knuth1984texbook,
  title={The TeXbook},
  author={Knuth, Donald Ervin},
  year={1984},
  publisher={Addison-Wesley}
}
`;

  it('parses multiple BibTeX entries into structured citation objects', () => {
    const entries = parseBibTeX(sampleBibTeX);
    expect(entries.length).toBe(2);

    const first = entries[0];
    expect(first.key).toBe('vaswani2017attention');
    expect(first.type).toBe('article');
    expect(first.title).toBe('Attention is all you need');
    expect(first.author).toContain('Vaswani, Ashish');
    expect(first.year).toBe('2017');
    expect(first.doi).toBe('10.5555/3295222.3295349');

    const second = entries[1];
    expect(second.key).toBe('knuth1984texbook');
    expect(second.type).toBe('book');
    expect(second.author).toBe('Knuth, Donald Ervin');
    expect(second.year).toBe('1984');
  });

  it('handles empty or malformed strings gracefully', () => {
    const entries = parseBibTeX('');
    expect(entries).toEqual([]);

    const malformed = parseBibTeX('This is just plain text without bibtex tags.');
    expect(malformed).toEqual([]);
  });

  it('formats structured citation objects back to standard BibTeX string', () => {
    const entry = {
      type: 'article',
      key: 'shannon1948',
      title: 'A Mathematical Theory of Communication',
      author: 'Shannon, Claude E.',
      year: '1948',
      journal: 'Bell System Technical Journal',
      doi: '10.1002/j.1538-7305.1948.tb01338.x',
    };

    const bibStr = formatBibTeX(entry);
    expect(bibStr).toContain('@article{shannon1948,');
    expect(bibStr).toContain('title = {A Mathematical Theory of Communication}');
    expect(bibStr).toContain('author = {Shannon, Claude E.}');
    expect(bibStr).toContain('year = {1948}');
    expect(bibStr).toContain('doi = {10.1002/j.1538-7305.1948.tb01338.x}');
  });
});
