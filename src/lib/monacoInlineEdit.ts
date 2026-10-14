import { streamInlineEdit, sanitizeInlineEdit, CONTEXT_LINES } from './agent/inlineEdit';
import { isAbortError } from './agent/types';

/**
 * In-editor AI inline edit, bound to Ctrl/Cmd+I.
 *
 * Why Ctrl+I and not Ctrl+K: `App.tsx` already binds Ctrl/Cmd+K to the Command
 * Palette on `window`. Rather than fight that listener, this uses the VS Code
 * Copilot convention. See AI_AGENT_ROADMAP.md §9.2.
 *
 * Flow: select text → Ctrl+I → type an instruction → the replacement streams
 * into the widget → Enter accepts, Esc rejects. Applied through
 * `executeEdits` + `pushUndoStop` so one Ctrl+Z undoes it completely.
 *
 * Unlike the completions provider this is PER EDITOR (actions and content
 * widgets belong to an instance), so it returns a disposable that EditorPane
 * must call on unmount — the editor remounts on every file switch.
 */

export interface InlineEditConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  mode: string;
  fileName?: string;
  /** Macro names without backslashes, for LaTeX fidelity. */
  macros?: string[];
  /** Snapshot hook, called with the current content before applying. */
  onBeforeApply?: (content: string) => void;
  /** Toast hook. */
  notify?: (message: string, kind: 'success' | 'info' | 'error') => void;
}

interface RangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface ModelLike {
  getValue(): string;
  getValueInRange(range: unknown): string;
  getLineCount(): number;
  getLineMaxColumn(line: number): number;
}

interface EditorLike {
  getModel(): ModelLike | null;
  getSelection(): RangeLike | null;
  addAction(action: {
    id: string;
    label: string;
    keybindings?: number[];
    contextMenuGroupId?: string;
    contextMenuOrder?: number;
    run: () => void;
  }): { dispose(): void };
  addContentWidget(widget: unknown): void;
  removeContentWidget(widget: unknown): void;
  layoutContentWidget(widget: unknown): void;
  executeEdits(source: string, edits: unknown[]): boolean;
  pushUndoStop(): void;
  focus(): void;
  onDidDispose?(listener: () => void): { dispose(): void };
}

interface MonacoLike {
  KeyMod: { CtrlCmd: number };
  KeyCode: { KeyI: number };
  Range: new (startLine: number, startCol: number, endLine: number, endCol: number) => unknown;
  editor?: { ContentWidgetPositionPreference?: { ABOVE: number; BELOW: number; EXACT: number } };
}

type Phase = 'prompt' | 'running' | 'review';

const WIDGET_ID = 'dexter.ai.inlineEdit';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function attachInlineEdit(
  editor: EditorLike,
  monaco: MonacoLike,
  getConfig: () => InlineEditConfig | null,
): { dispose(): void } {
  // --- DOM -----------------------------------------------------------------
  const root = el('div', 'ai-inline-edit');
  const row = el('div', 'aie-row');
  const input = el('input', 'aie-input');
  input.type = 'text';
  input.placeholder = 'Edit with AI — describe the change, then press Enter';
  input.setAttribute('aria-label', 'AI inline edit instruction');
  const runBtn = el('button', 'btn xs primary aie-run', 'Run');
  row.append(input, runBtn);

  const status = el('div', 'aie-status muted small');
  const preview = el('pre', 'aie-preview');
  const foot = el('div', 'aie-foot');
  const acceptBtn = el('button', 'btn xs primary', 'Accept');
  const rejectBtn = el('button', 'btn xs ghost', 'Reject');
  foot.append(acceptBtn, rejectBtn);
  root.append(row, status, preview, foot);

  // Keep Monaco's keybinding service out of our input.
  root.addEventListener('keydown', (e) => e.stopPropagation());
  root.addEventListener('mousedown', (e) => e.stopPropagation());

  // --- state ---------------------------------------------------------------
  let open = false;
  let phase: Phase = 'prompt';
  let range: RangeLike | null = null;
  let result = '';
  let abort: AbortController | null = null;

  const pref = monaco.editor?.ContentWidgetPositionPreference;
  const preference = pref ? [pref.BELOW, pref.ABOVE] : [2, 1];

  const widget = {
    getId: () => WIDGET_ID,
    getDomNode: () => root,
    getPosition: () => (range
      ? {
        position: { lineNumber: range.startLineNumber, column: 1 },
        preference,
      }
      : null),
  };

  function render() {
    root.dataset.phase = phase;
    runBtn.disabled = phase === 'running';
    input.disabled = phase === 'running';
    foot.style.display = phase === 'review' ? 'flex' : 'none';
    preview.style.display = phase === 'prompt' ? 'none' : 'block';
    if (phase === 'prompt') {
      preview.textContent = '';
      status.textContent = '';
    }
  }

  function close(restoreFocus = true) {
    if (!open) return;
    abort?.abort();
    abort = null;
    open = false;
    phase = 'prompt';
    result = '';
    input.value = '';
    try { editor.removeContentWidget(widget); } catch { /* noop */ }
    render();
    if (restoreFocus) editor.focus();
  }

  function contextAround(model: ModelLike, r: RangeLike): { before: string; after: string } {
    const beforeStart = Math.max(1, r.startLineNumber - CONTEXT_LINES);
    const afterEnd = Math.min(model.getLineCount(), r.endLineNumber + CONTEXT_LINES);
    // Ranges stop/start at the selection's own columns so same-line text on
    // either side is included — a mid-line selection must not look isolated.
    const before = model.getValueInRange(
      new monaco.Range(beforeStart, 1, r.startLineNumber, r.startColumn),
    );
    const after = model.getValueInRange(
      new monaco.Range(r.endLineNumber, r.endColumn, afterEnd, model.getLineMaxColumn(afterEnd)),
    );
    return { before, after };
  }

  async function run() {
    const cfg = getConfig();
    const model = editor.getModel();
    const instruction = input.value.trim();
    if (!instruction || !model || !range || phase === 'running') return;
    if (!cfg) {
      status.textContent = 'AI is not configured. Open BYOK and save a key.';
      return;
    }

    phase = 'running';
    result = '';
    preview.textContent = '';
    status.textContent = 'Generating…';
    render();

    const selected = model.getValueInRange(
      new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn),
    );
    const { before, after } = contextAround(model, range);

    const ac = new AbortController();
    abort = ac;

    try {
      for await (const delta of streamInlineEdit({
        provider: cfg.provider,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        mode: cfg.mode,
        fileName: cfg.fileName,
        macros: cfg.macros,
        selected,
        before,
        after,
        instruction,
        signal: ac.signal,
      })) {
        result += delta;
        preview.textContent = result;
        editor.layoutContentWidget(widget);
      }
      result = sanitizeInlineEdit(result);
      preview.textContent = result;
      if (!result) {
        phase = 'prompt';
        status.textContent = 'The model returned nothing. Try rephrasing the instruction.';
        render();
        input.focus();
        return;
      }
      phase = 'review';
      status.textContent = selected
        ? `Replaces lines ${range.startLineNumber}-${range.endLineNumber}. Enter to accept, Esc to reject.`
        : 'Inserts at the cursor. Enter to accept, Esc to reject.';
      render();
      editor.layoutContentWidget(widget);
      acceptBtn.focus();
    } catch (e) {
      if (isAbortError(e)) {
        close();
        return;
      }
      phase = 'prompt';
      status.textContent = e instanceof Error ? e.message : String(e);
      render();
      input.focus();
    } finally {
      if (abort === ac) abort = null;
    }
  }

  function accept() {
    // Guard against double-activation: Enter on the focused Accept button can
    // reach both the keydown handler and the synthesized click.
    if (phase !== 'review') return;
    const model = editor.getModel();
    if (!model || !range || !result) return;
    const cfg = getConfig();
    cfg?.onBeforeApply?.(model.getValue());
    editor.executeEdits('dexter-inline-edit', [{
      range: new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn),
      text: result,
      forceMoveMarkers: true,
    }]);
    // One undo stop ⇒ a single Ctrl+Z reverts the whole AI edit.
    editor.pushUndoStop();
    cfg?.notify?.('AI edit applied — Ctrl+Z to undo', 'success');
    close();
  }

  function openWidget() {
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!model || !selection) return;
    range = {
      startLineNumber: selection.startLineNumber,
      startColumn: selection.startColumn,
      endLineNumber: selection.endLineNumber,
      endColumn: selection.endColumn,
    };
    if (open) {
      editor.layoutContentWidget(widget);
    } else {
      open = true;
      editor.addContentWidget(widget);
    }
    phase = 'prompt';
    result = '';
    render();
    const hasSelection =
      range.startLineNumber !== range.endLineNumber || range.startColumn !== range.endColumn;
    input.placeholder = hasSelection
      ? 'Rewrite the selection — describe the change, then press Enter'
      : 'Generate at the cursor — describe what to write, then press Enter';
    input.focus();
  }

  // --- events --------------------------------------------------------------
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  root.addEventListener('keydown', (e) => {
    if (phase !== 'review') {
      if (e.key === 'Escape' && phase === 'running') {
        e.preventDefault();
        close();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      accept();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  runBtn.addEventListener('click', () => void run());
  acceptBtn.addEventListener('click', accept);
  rejectBtn.addEventListener('click', () => close());

  const action = editor.addAction({
    id: 'dexter.ai.inlineEdit',
    label: 'AI: Inline edit (Ctrl+I)',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
    contextMenuGroupId: 'modification',
    contextMenuOrder: 1,
    run: openWidget,
  });

  const disposeListener = editor.onDidDispose?.(() => close(false));

  render();

  return {
    dispose() {
      abort?.abort();
      try { action.dispose(); } catch { /* noop */ }
      try { disposeListener?.dispose(); } catch { /* noop */ }
      if (open) {
        try { editor.removeContentWidget(widget); } catch { /* noop */ }
        open = false;
      }
    },
  };
}
