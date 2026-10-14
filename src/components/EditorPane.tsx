import { useEffect, useRef, type MutableRefObject } from 'react';
import Editor, { type EditorProps, type OnMount } from '@monaco-editor/react';
import type { DocMode } from '../lib/templates';
import { monacoLanguageFor, registerTypstLanguage } from '../lib/monacoTypst';
import { registerLatexLanguage } from '../lib/monacoLatex';
import { DEXTER_DARK_THEME, DEXTER_LIGHT_THEME, MONACO_FONT, registerDexterThemes } from '../lib/monacoTheme';
import { cancelInflightCompletion, registerAiInlineCompletion, setAiCompletionConfig } from '../lib/monacoAiCompletion';
import { attachInlineEdit, type InlineEditConfig } from '../lib/monacoInlineEdit';
import { detectDocMacros } from '../lib/agent';
import type { CollabSession } from '../lib/collab';

/** AI settings the editor needs for ghost text and Ctrl+I inline edit. */
export interface EditorAiSettings {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  /** Ghost-text completion. Off by default — see AI_AGENT_ROADMAP.md §10. */
  completionEnabled: boolean;
  fileName?: string;
  /** Called when the completion circuit breaker trips, so the UI can switch off. */
  onRateLimited?: (message: string) => void;
  /** Snapshot hook, called with the content before an inline edit is applied. */
  onBeforeApply?: (content: string) => void;
  notify?: (message: string, kind: 'success' | 'info' | 'error') => void;
}

interface Props {
  value: string;
  mode: DocMode;
  theme: 'dark' | 'light';
  onChange: (v: string) => void;
  onSelection: (text: string, startLine: number, endLine: number) => void;
  editorRef: MutableRefObject<unknown>;
  /** When set, the editor binds to the shared Y.Text (uncontrolled mode). */
  collab: { session: CollabSession; fileId: string } | null;
  /** Omit to disable the in-editor AI features entirely. */
  ai?: EditorAiSettings;
}

export default function EditorPane({ value, mode, theme, onChange, onSelection, editorRef, collab, ai }: Props) {
  const bindingRef = useRef<{ destroy: () => void } | null>(null);
  const inlineEditRef = useRef<{ dispose: () => void } | null>(null);
  const goneRef = useRef(false);
  const collabRef = useRef(collab);
  collabRef.current = collab;
  const aiRef = useRef(ai);
  aiRef.current = ai;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Shared (live) initial content — idempotent, safe under StrictMode.
  const liveInitial = collab ? collab.session.ensureYText(collab.fileId, value).toString() : null;

  useEffect(() => {
    goneRef.current = false;
    return () => {
      goneRef.current = true;
      try { bindingRef.current?.destroy(); } catch { /* noop */ }
      bindingRef.current = null;
      try { inlineEditRef.current?.dispose(); } catch { /* noop */ }
      inlineEditRef.current = null;
      // The completions provider lives at module scope and is shared, so only
      // its config is cleared here — never the registration itself.
      setAiCompletionConfig(null);
      cancelInflightCompletion();
    };
  }, []);

  // Keep the module-scope completion config in step with props.
  useEffect(() => {
    if (!ai) {
      setAiCompletionConfig(null);
      cancelInflightCompletion();
      return;
    }
    setAiCompletionConfig({
      enabled: ai.completionEnabled,
      provider: ai.provider,
      apiKey: ai.apiKey,
      baseUrl: ai.baseUrl,
      model: ai.model,
      mode,
      fileName: ai.fileName,
      onRateLimited: ai.onRateLimited,
    });
    if (!ai.completionEnabled) cancelInflightCompletion();
  }, [ai, mode]);

  const handleMount: OnMount = (editor, monaco) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editorRef as any).current = {
      getSelectionText: () => {
        const sel = editor.getSelection();
        const model = editor.getModel();
        if (!sel || !model) return { text: '', startLine: 0, endLine: 0 };
        return { text: model.getValueInRange(sel), startLine: sel.startLineNumber, endLine: sel.endLineNumber };
      },
      _editor: editor, _monaco: monaco,
    };

    const c = collabRef.current;
    if (c) {
      try {
        const model = editor.getModel();
        const ytext = c.session.ensureYText(c.fileId, editor.getValue());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = c.session.bindEditor(ytext, model, editor, monaco as any);
        if (goneRef.current) {
          try { b.destroy(); } catch { /* noop */ }
        } else {
          try { bindingRef.current?.destroy(); } catch { /* noop */ }
          bindingRef.current = b;
        }
      } catch { /* binding is best-effort; local editing still works */ }
    }

    editor.onDidChangeCursorSelection((e) => {
      const model = editor.getModel();
      if (!model) return;
      const text = model.getValueInRange(e.selection);
      // Report the cleared state too, otherwise the last selection stays
      // latched in App state and the "Ask AI" chip never disappears.
      if (!text || text.length <= 1 || text.length >= 4000) {
        onSelection('', 0, 0);
        return;
      }
      onSelection(text, e.selection.startLineNumber, e.selection.endLineNumber);
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {});

    // Ctrl+I inline edit. Per-editor, so it must be disposed on unmount —
    // App.tsx keys this component by file id, so it remounts on file switch.
    try {
      inlineEditRef.current?.dispose();
      inlineEditRef.current = attachInlineEdit(editor, monaco, (): InlineEditConfig | null => {
        const a = aiRef.current;
        if (!a) return null;
        const model = editor.getModel();
        const text = model ? model.getValue() : '';
        return {
          provider: a.provider,
          apiKey: a.apiKey,
          baseUrl: a.baseUrl,
          model: a.model,
          mode: modeRef.current,
          fileName: a.fileName,
          // Computed on open rather than per keystroke — this parses the doc.
          macros: detectDocMacros(text, modeRef.current),
          onBeforeApply: a.onBeforeApply,
          notify: a.notify,
        };
      });
    } catch { /* inline edit is best-effort */ }
  };

  const common: Pick<EditorProps, 'theme' | 'onMount' | 'beforeMount' | 'options'> = {
    theme: theme === 'dark' ? DEXTER_DARK_THEME : DEXTER_LIGHT_THEME,
    onMount: handleMount,
    beforeMount: (monaco) => {
      registerTypstLanguage(monaco);
      registerLatexLanguage(monaco);
      registerDexterThemes(monaco);
      // One-shot module-scope registration, shared by every editor instance.
      registerAiInlineCompletion(monaco);
    },
    options: {
      minimap: { enabled: false },
      fontFamily: MONACO_FONT,
      fontLigatures: true,
      fontSize: 13.5,
      lineHeight: 22,
      lineNumbers: 'on',
      folding: true,
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      renderWhitespace: 'none',
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      cursorStyle: 'line',
      renderLineHighlight: 'all',
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true,
      },
      smoothScrolling: true,
      padding: { top: 12, bottom: 12 },
      // Ghost text only appears when the provider returns something, which it
      // never does while the feature is toggled off.
      inlineSuggest: { enabled: true },
      find: { addExtraSpaceOnTop: false, autoFindInSelection: 'multiline' } as never,
    },
  };

  if (collab) {
    return (
      <div className="editor-wrap">
        <Editor
          height="100%"
          language={monacoLanguageFor(mode)}
          defaultValue={liveInitial ?? value}
          {...common}
          onChange={(v) => onChange(v ?? '')}
        />
      </div>
    );
  }
  return (
    <div className="editor-wrap">
      <Editor
        height="100%"
        language={monacoLanguageFor(mode)}
        value={value}
        {...common}
        onChange={(v) => onChange(v ?? '')}
      />
    </div>
  );
}
