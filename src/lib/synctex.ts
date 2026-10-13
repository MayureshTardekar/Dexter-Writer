// SyncTeX forward search: PDF click → source line.
// The engine already compiles with `-synctex=1`; the .synctex.gz bytes flow
// through the compile result. This module gunzips (native DecompressionStream,
// no dependency) and parses the content nodes into per-page position records.

export interface SyncTexNode {
  page: number;
  /** PDF points, origin TOP-LEFT (matches DOM click math directly). */
  x: number;
  y: number;
  file: number;
  line: number;
}

export interface SyncTexData {
  files: Map<number, string>;
  nodes: SyncTexNode[];
}

/** 1 SyncTeX unit = 1/65781.76 PDF points (65536 sp/pt × 72/72.27). */
const SYNC_UNIT = 65781.76;

export async function gunzipSyncTex(data: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Gzip decompression is not supported in this browser.');
  }
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * Parse uncompressed .synctex text. Tracks the h/v block stack so each
 * content node (xF,L:...) inherits its page position. Malformed lines and
 * unknown constructs are skipped — never throw on real-world files.
 */
export function parseSyncTex(text: string): SyncTexData {
  const files = new Map<number, string>();
  const nodes: SyncTexNode[] = [];
  let page = 0;
  // Stack of open blocks; h/v blocks carry the current position.
  const stack: Array<{ kind: string; x: number; y: number }> = [];
  let curX = 0;
  let curY = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (line.length === 0) continue;
    const head = line[0];
    try {
      if (head === 'I') {
        // Input:1:/path/main.tex
        const m = /^Input:(\d+):(.*)$/.exec(line);
        if (m) files.set(Number(m[1]), m[2]);
      } else if (head === '{') {
        // {page — new page block
        const n = Number(line.slice(1));
        if (Number.isInteger(n) && n > 0) {
          page = n;
          stack.length = 0;
          curX = 0;
          curY = 0;
        }
        stack.push({ kind: '{', x: curX, y: curY });
      } else if (head === '[' || head === '(') {
        // [F,L:X,Y:W,H,D h-block | (F,L:X,Y:W,H,D v-block
        const m = /^[([]\d+,\d+:(-?\d+),(-?\d+)/.exec(line);
        if (m) {
          curX = Number(m[1]) / SYNC_UNIT;
          curY = Number(m[2]) / SYNC_UNIT;
        }
        stack.push({ kind: head, x: curX, y: curY });
      } else if (head === '}' || head === ']' || head === ')') {
        const prev = stack.pop();
        if (prev) {
          curX = prev.x;
          curY = prev.y;
        }
      } else if (head === 'x' || head === 'g' || head === 'k') {
        // x<file>,<line>:<col>,<h>,<v>:<w>,<h>,<d>
        const m = /^[xgk](\d+),(\d+)/.exec(line);
        if (m && page > 0) {
          nodes.push({
            page,
            x: curX,
            y: curY,
            file: Number(m[1]),
            line: Number(m[2]),
          });
        }
      }
    } catch {
      // Skip anything unexpected; partial data still jumps usefully.
    }
  }
  return { files, nodes };
}

/**
 * Forward search: given a click (page + top-left-origin PDF points),
 * return the source line. Prefers the nearest node at/above the click
 * (reading order), breaking ties by horizontal closeness.
 */
export function forwardSearch(data: SyncTexData, page: number, x: number, y: number): { file: number; line: number } | null {
  const onPage = data.nodes.filter((n) => n.page === page && n.line > 0);
  if (onPage.length === 0) return null;
  const TOL = 2; // points of slack below the click
  let best: SyncTexNode | null = null;
  let bestScore = Infinity;
  for (const n of onPage) {
    const dy = y - n.y;
    if (dy < -TOL) continue; // strictly below the click — skip unless nothing else
    const score = Math.max(0, dy) * 4 + Math.abs(n.x - x);
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  }
  if (!best) {
    // Clicked above everything (e.g. top margin) — take the topmost node.
    best = onPage.reduce((a, b) => (a.y < b.y || (a.y === b.y && a.x < b.x) ? a : b));
  }
  return { file: best.file, line: best.line };
}

/** File index that holds the main document (usually 1). */
export function mainInputFile(data: SyncTexData): number {
  if (data.files.has(1)) return 1;
  const first = [...data.files.keys()].sort((a, b) => a - b)[0];
  return first ?? 1;
}
