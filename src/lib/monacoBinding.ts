import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';

// Dependency-free Y.Text <-> Monaco binding (replaces y-monaco so the app
// keeps its single CDN-loaded monaco instance and the Yjs stack stays lazy).
// Semantics mirror y-monaco: Y deltas apply via applyEdits (no undo pollution),
// model changes merge right-to-left, cursors are preserved across remote edits,
// and remote selections render as decorations.

interface PositionLike {
  lineNumber: number;
  column: number;
}

export interface BindingModel {
  getValue: () => string;
  getPositionAt: (offset: number) => PositionLike;
  getOffsetAt: (pos: PositionLike) => number;
  applyEdits?: (edits: Array<{ range: unknown; text: string }>) => void;
  pushEditOperations: (before: unknown, edits: Array<{ range: unknown; text: string | null; forceMoveMarkers?: boolean }>, computer: unknown) => unknown;
  onDidChangeModelContent: (fn: (e: { changes: Array<{ rangeOffset: number; rangeLength: number; text: string }> }) => void) => { dispose: () => void };
  onWillDispose?: (fn: () => void) => { dispose: () => void };
}

export interface BindingEditor {
  getModel: () => BindingModel | null;
  setSelection: (sel: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) => void;
  getSelection: () => { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null;
  onDidChangeCursorSelection: (fn: (e: { selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }) => void) => { dispose: () => void };
  deltaDecorations: (oldIds: string[], decs: Array<{ range: unknown; options: Record<string, unknown> }>) => string[];
}

export interface BindingMonacoNs {
  Range: new (sl: number, sc: number, el: number, ec: number) => unknown;
  Selection: new (sl: number, sc: number, el: number, ec: number) => { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
}

interface DeltaOp {
  retain?: number;
  delete?: number;
  insert?: string | unknown[];
}

interface YTextEventLike {
  delta?: DeltaOp[];
  changes?: { delta?: DeltaOp[] };
}

export interface YPositionLib {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createRelativePositionFromTypeIndex: (type: any, index: number) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createAbsolutePositionFromRelativePosition: (rel: any, doc: any) => { type: unknown; index: number } | null;
}

function getDelta(event: YTextEventLike): DeltaOp[] {
  if (Array.isArray(event.delta)) return event.delta;
  if (event.changes && Array.isArray(event.changes.delta)) return event.changes.delta;
  return [];
}

export interface BindingHandle {
  destroy: () => void;
}

export function createMonacoBinding(opts: {
  ytext: Y.Text;
  model: BindingModel;
  editor: BindingEditor;
  monaco: BindingMonacoNs;
  awareness?: Awareness | null;
  ylib?: YPositionLib | null;
}): BindingHandle {
  const { ytext, model, editor, monaco, awareness, ylib } = opts;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const y = ytext as any;
  const doc = y.doc;
  let fromY = false;
  let fromModel = false;
  let disposed = false;
  let decorIds: string[] = [];

  const disposables: Array<{ dispose: () => void }> = [];

  function saveSelection(): unknown {
    if (!ylib || !doc) return null;
    try {
      const sel = editor.getSelection();
      if (!sel) return null;
      const anchor = model.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn });
      const head = model.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn });
      return {
        anchor: ylib.createRelativePositionFromTypeIndex(y, anchor),
        head: ylib.createRelativePositionFromTypeIndex(y, head),
      };
    } catch {
      return null;
    }
  }

  function restoreSelection(saved: unknown): void {
    if (!ylib || !doc || !saved) return;
    try {
      const s = saved as { anchor: unknown; head: unknown };
      const aAbs = ylib.createAbsolutePositionFromRelativePosition(s.anchor, doc);
      const hAbs = ylib.createAbsolutePositionFromRelativePosition(s.head, doc);
      if (!aAbs || !hAbs || aAbs.type !== y || hAbs.type !== y) return;
      const a = model.getPositionAt(Math.min(aAbs.index, model.getValue().length));
      const h = model.getPositionAt(Math.min(hAbs.index, model.getValue().length));
      editor.setSelection(new monaco.Selection(a.lineNumber, a.column, h.lineNumber, h.column));
    } catch { /* noop */ }
  }

  function publishSelection(): void {
    if (!awareness || !ylib || !doc || disposed) return;
    try {
      const sel = editor.getSelection();
      if (!sel) return;
      const anchor = model.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn });
      const head = model.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn });
      awareness.setLocalStateField('selection', {
        anchor: ylib.createRelativePositionFromTypeIndex(y, anchor),
        head: ylib.createRelativePositionFromTypeIndex(y, head),
      });
    } catch { /* noop */ }
  }

  function renderDecorations(): void {
    if (!awareness || disposed) return;
    try {
      const next: Array<{ range: unknown; options: Record<string, unknown> }> = [];
      awareness.getStates().forEach((state, clientID) => {
        if (clientID === doc?.clientID) return;
        const sel = (state as { selection?: { anchor?: unknown; head?: unknown } })?.selection;
        if (!sel?.anchor || !sel?.head || !ylib || !doc) return;
        const aAbs = ylib.createAbsolutePositionFromRelativePosition(sel.anchor, doc);
        const hAbs = ylib.createAbsolutePositionFromRelativePosition(sel.head, doc);
        if (!aAbs || !hAbs || aAbs.type !== y || hAbs.type !== y) return;
        const lo = Math.min(aAbs.index, hAbs.index);
        const hi = Math.max(aAbs.index, hAbs.index);
        if (lo === hi) return;
        const start = model.getPositionAt(lo);
        const end = model.getPositionAt(hi);
        next.push({
          range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          options: {
            className: `yRemoteSelection yRemoteSelection-${String(clientID)}`,
            afterContentClassName: `yRemoteSelectionHead yRemoteSelectionHead-${String(clientID)}`,
          },
        });
      });
      decorIds = editor.deltaDecorations(decorIds, next);
    } catch { /* noop */ }
  }

  const yObserver = (event: YTextEventLike) => {
    if (fromModel || disposed) return;
    fromY = true;
    const saved = saveSelection();
    try {
      const delta = getDelta(event);
      let index = 0;
      for (const op of delta) {
        if (op.retain !== undefined) {
          index += op.retain;
        } else if (op.insert !== undefined) {
          const ins = Array.isArray(op.insert) ? '' : String(op.insert);
          if (ins) {
            const pos = model.getPositionAt(index);
            const range = new monaco.Selection(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
            if (model.applyEdits) model.applyEdits([{ range, text: ins }]);
            else model.pushEditOperations([], [{ range, text: ins, forceMoveMarkers: true }], () => null);
            index += ins.length;
          }
        } else if (op.delete !== undefined) {
          const pos = model.getPositionAt(index);
          const end = model.getPositionAt(index + op.delete);
          const range = new monaco.Selection(pos.lineNumber, pos.column, end.lineNumber, end.column);
          if (model.applyEdits) model.applyEdits([{ range, text: '' }]);
          else model.pushEditOperations([], [{ range, text: '', forceMoveMarkers: true }], () => null);
        }
      }
    } finally {
      fromY = false;
    }
    restoreSelection(saved);
    renderDecorations();
  };

  y.observe(yObserver);

  disposables.push(
    model.onDidChangeModelContent((e) => {
      if (fromY || disposed) return;
      fromModel = true;
      try {
        const apply = () => {
          const changes = [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);
          for (const c of changes) {
            if (c.rangeLength > 0) y.delete(c.rangeOffset, c.rangeLength);
            if (c.text) y.insert(c.rangeOffset, c.text);
          }
        };
        if (doc) doc.transact(apply);
        else apply();
      } finally {
        fromModel = false;
      }
    }),
  );

  disposables.push(editor.onDidChangeCursorSelection(() => publishSelection()));

  const onAware = () => renderDecorations();
  if (awareness) awareness.on('change', onAware);
  if (model.onWillDispose) {
    disposables.push(model.onWillDispose(() => handle.destroy()));
  }

  // Snap model to shared state if diverged (Y wins).
  try {
    const shared = y.toString() as string;
    if (model.getValue() !== shared) {
      fromY = true;
      try {
        if (model.applyEdits) {
          const end = model.getPositionAt(model.getValue().length);
          model.applyEdits([{ range: new monaco.Selection(1, 1, end.lineNumber, end.column), text: shared }]);
        }
      } finally {
        fromY = false;
      }
    }
  } catch { /* noop */ }

  publishSelection();
  renderDecorations();

  const handle: BindingHandle = {
    destroy: () => {
      if (disposed) return;
      disposed = true;
      try { y.unobserve(yObserver); } catch { /* noop */ }
      try { if (awareness) awareness.off('change', onAware); } catch { /* noop */ }
      for (const d of disposables) {
        try { d.dispose(); } catch { /* noop */ }
      }
      try { editor.deltaDecorations(decorIds, []); } catch { /* noop */ }
      decorIds = [];
    },
  };
  return handle;
}
