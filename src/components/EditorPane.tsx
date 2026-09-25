import { useEffect, useRef, type MutableRefObject } from 'react';
import Editor, { type EditorProps, type OnMount } from '@monaco-editor/react';
import type { DocMode } from '../lib/templates';
import { monacoLanguageFor, registerTypstLanguage } from '../lib/monacoTypst';
import { DEXTER_DARK_THEME, DEXTER_LIGHT_THEME, MONACO_FONT, registerDexterThemes } from '../lib/monacoTheme';
import type { CollabSession } from '../lib/collab';

interface Props {
  value: string;
  mode: DocMode;
  theme: 'dark' | 'light';
  onChange: (v: string) => void;
  onSelection: (text: string, startLine: number, endLine: number) => void;
  editorRef: MutableRefObject<unknown>;
  /** When set, the editor binds to the shared Y.Text (uncontrolled mode). */
  collab: { session: CollabSession; fileId: string } | null;
}

export default function EditorPane({ value, mode, theme, onChange, onSelection, editorRef, collab }: Props) {
  const monacoRef = useRef<{ editor: unknown } | null>(null);
  const bindingRef = useRef<{ destroy: () => void } | null>(null);
  const goneRef = useRef(false);
  const collabRef = useRef(collab);
  collabRef.current = collab;

  // Shared (live) initial content — idempotent, safe under StrictMode.
  const liveInitial = collab ? collab.session.ensureYText(collab.fileId, value).toString() : null;

  useEffect(() => {
    goneRef.current = false;
    return () => {
      goneRef.current = true;
      try { bindingRef.current?.destroy(); } catch { /* noop */ }
      bindingRef.current = null;
    };
  }, []);

  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = { editor };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editorRef as any).current = {
      getSelectionText: () => {
        const sel = editor.getSelection();
        const model = editor.getModel();
        if (!sel || !model) return { text: '', startLine: 0, endLine: 0 };
        return { text: model.getValueInRange(sel), startLine: sel.startLineNumber, endLine: sel.endLineNumber };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      if (text && text.length > 1 && text.length < 4000) {
        onSelection(text, e.selection.startLineNumber, e.selection.endLineNumber);
      }
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {});
  };

  const common: Pick<EditorProps, 'theme' | 'onMount' | 'beforeMount' | 'options'> = {
    theme: theme === 'dark' ? DEXTER_DARK_THEME : DEXTER_LIGHT_THEME,
    onMount: handleMount,
    beforeMount: (monaco) => {
      registerTypstLanguage(monaco);
      registerDexterThemes(monaco);
    },
    options: {
      minimap: { enabled: false },
      fontFamily: MONACO_FONT,
      fontLigatures: true,
      fontSize: 13.5,
      lineNumbers: 'on',
      folding: true,
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      renderWhitespace: 'none',
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      padding: { top: 10 },
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
