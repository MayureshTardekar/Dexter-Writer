import { describe, it, expect } from 'vitest';
import { parseSyncTex, forwardSearch, mainInputFile } from '../synctex';

// Minimal but structurally faithful .synctex sample: 1 page, two lines.
const SAMPLE = `SyncTeX Version:1
Input:1:/docs/resume.tex
Input:2:/usr/share/texlive/font.sty
X Offset:0
Y Offset:0
{1
[1,5:657818,1315635:+0
(1,5:657818,1315635:+0
x1,5:0,0:657818,1315635:+0
)
(1,9:657818,1973453:+0
x1,9:0,0:657818,1973453:+0
x1,12:3289090,1973453:+0
)
]
}
{2
[2,30:657818,657818:+0
x1,30:0,0:657818,657818:+0
]
}
`;

describe('parseSyncTex', () => {
  it('reads input files and content nodes with positions', () => {
    const data = parseSyncTex(SAMPLE);
    expect(data.files.get(1)).toBe('/docs/resume.tex');
    expect(data.nodes.length).toBe(4);
    // 657818 / 65781.76 ≈ 10pt
    expect(data.nodes[0]).toMatchObject({ page: 1, file: 1, line: 5 });
    expect(data.nodes[0].x).toBeCloseTo(10, 1);
    expect(data.nodes[0].y).toBeCloseTo(20, 1);
  });

  it('never throws on garbage', () => {
    const data = parseSyncTex('garbage\n{not a page\nx\n[1,\n');
    expect(data.nodes).toEqual([]);
    expect(mainInputFile(data)).toBe(1);
  });

  it('picks the main input file', () => {
    expect(mainInputFile(parseSyncTex(SAMPLE))).toBe(1);
  });
});

describe('forwardSearch', () => {
  const data = parseSyncTex(SAMPLE);

  it('maps a click near a line to that line', () => {
    // line 5 sits around y≈20pt; click just below it
    expect(forwardSearch(data, 1, 50, 22)).toMatchObject({ line: 5 });
    // click near line 9 (y≈30pt)
    expect(forwardSearch(data, 1, 50, 31)).toMatchObject({ line: 9 });
  });

  it('respects page boundaries', () => {
    expect(forwardSearch(data, 2, 50, 12)).toMatchObject({ line: 30 });
    expect(forwardSearch(data, 3, 50, 12)).toBeNull();
  });

  it('falls back to topmost node when clicking the top margin', () => {
    expect(forwardSearch(data, 1, 50, 1)).toMatchObject({ line: 5 });
  });
});
