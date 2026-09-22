// Minimal line-based diff (LCS with Hirschberg-free DP, capped for large docs).

export type HunkKind = 'equal' | 'replace' | 'insert' | 'delete';

export interface DiffHunk {
  id: number;
  kind: HunkKind;
  origStart: number; // 1-indexed, inclusive; may be origEnd+1 for pure inserts
  origEnd: number;
  newStart: number;
  newEnd: number;
  origLines: string[];
  newLines: string[];
}

const MAX_DP_LINES = 1200;

export function computeHunks(before: string, after: string): DiffHunk[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > MAX_DP_LINES || b.length > MAX_DP_LINES) {
    return [
      {
        id: 0, kind: a.length === b.length && before === after ? 'equal' : 'replace',
        origStart: 1, origEnd: a.length, newStart: 1, newEnd: b.length,
        origLines: a.slice(0, 400), newLines: b.slice(0, 400),
      },
    ];
  }
  const n = a.length;
  const m = b.length;
  // LCS length table (suffix DP, Int32 to stay lean)
  const dp: Int32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  interface Op { kind: 'eq' | 'del' | 'ins'; line: string }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ kind: 'eq', line: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ kind: 'del', line: a[i] }); i++; }
    else { ops.push({ kind: 'ins', line: b[j] }); j++; }
  }
  while (i < n) { ops.push({ kind: 'del', line: a[i] }); i++; }
  while (j < m) { ops.push({ kind: 'ins', line: b[j] }); j++; }

  // Group into hunks with 2 lines of context
  const hunks: DiffHunk[] = [];
  let id = 0;
  let oi = 1;
  let ni = 1;
  let k = 0;
  while (k < ops.length) {
    // skip equals, tracking line numbers
    if (ops[k].kind === 'eq') { oi++; ni++; k++; continue; }
    // change block start
    const startOi = oi;
    const startNi = ni;
    const origLines: string[] = [];
    const newLines: string[] = [];
    let hasDel = false;
    let hasIns = false;
    while (k < ops.length && ops[k].kind !== 'eq') {
      if (ops[k].kind === 'del') { origLines.push(ops[k].line); hasDel = true; oi++; }
      else { newLines.push(ops[k].line); hasIns = true; ni++; }
      k++;
    }
    const kind: HunkKind = hasDel && hasIns ? 'replace' : hasDel ? 'delete' : 'insert';
    hunks.push({
      id: id++, kind,
      origStart: startOi, origEnd: oi - 1, newStart: startNi, newEnd: ni - 1,
      origLines, newLines,
    });
  }
  if (hunks.length === 0) {
    return [{ id: 0, kind: 'equal', origStart: 1, origEnd: n, newStart: 1, newEnd: m, origLines: [], newLines: [] }];
  }
  return hunks;
}

/** Rebuild document from hunks + accepted set (accepted hunk ids take the NEW side). */
export function applyHunks(before: string, hunks: DiffHunk[], accepted: Set<number>): string {
  const a = before.split('\n');
  const out: string[] = [];
  let cursor = 1; // 1-indexed into `a`
  const ordered = [...hunks].sort((x, y) => x.origStart - y.origStart);
  for (const h of ordered) {
    // copy unchanged lines before this hunk
    while (cursor < h.origStart && cursor <= a.length) { out.push(a[cursor - 1]); cursor++; }
    if (h.kind === 'equal') {
      for (const l of h.origLines) out.push(l);
      cursor = h.origEnd + 1;
      continue;
    }
    if (accepted.has(h.id)) {
      for (const l of h.newLines) out.push(l);
    } else {
      for (const l of h.origLines) out.push(l);
    }
    cursor = Math.max(cursor, h.origEnd + 1);
  }
  while (cursor <= a.length) { out.push(a[cursor - 1]); cursor++; }
  return out.join('\n');
}

export function hunkLabel(h: DiffHunk): string {
  if (h.kind === 'insert') return `+ Insert ${h.newLines.length} line(s) after line ${h.origStart - 1}`;
  if (h.kind === 'delete') return `− Delete lines ${h.origStart}-${h.origEnd}`;
  return `~ Rewrite lines ${h.origStart}-${h.origEnd} (${h.newLines.length} new)`;
}
