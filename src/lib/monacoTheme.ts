// Monaco editor themes matched to the Dexter Write design tokens
// (obsidian dark / clean paper light). Registered once via beforeMount.

interface MonacoThemeApi {
  editor: {
    defineTheme: (name: string, theme: unknown) => void;
  };
}

let registered = false;

const OBSIDIAN_RULES = [
  { token: 'comment', foreground: '7f7f84', fontStyle: 'italic' },
  { token: 'comment.doc', foreground: '8a8a8e', fontStyle: 'italic' },
  { token: 'keyword', foreground: 'c9a86a' },
  { token: 'keyword.control', foreground: 'c9a86a' },
  { token: 'keyword.operator', foreground: 'a1a1a6' },
  { token: 'type', foreground: 'a8b8a0' },
  { token: 'tag', foreground: '9aa8b8' },
  { token: 'string', foreground: 'a3b58f' },
  { token: 'string.escape', foreground: 'b9a06a' },
  { token: 'number', foreground: 'b9a06a' },
  { token: 'delimiter', foreground: 'b8b8bc' },
  { token: 'delimiter.curly', foreground: 'c9a86a' },
  { token: 'delimiter.bracket', foreground: '9aa4b0' },
  { token: 'delimiter.parenthesis', foreground: '9aa4b0' },
  { token: 'attribute.name', foreground: 'b9a06a' },
  { token: 'attribute.value', foreground: 'a3b58f' },
  { token: 'variable', foreground: '9aa8b8' },
  { token: 'variable.parameter', foreground: '9aa8b8' },
  { token: 'constant', foreground: 'b9a06a' },
  { token: 'emphasis', fontStyle: 'italic' },
  { token: 'strong', fontStyle: 'bold' },
];

const PAPER_RULES = [
  { token: 'comment', foreground: '7a7a76', fontStyle: 'italic' },
  { token: 'comment.doc', foreground: '6a6a66', fontStyle: 'italic' },
  { token: 'keyword', foreground: '8a5a2b' },
  { token: 'keyword.control', foreground: '8a5a2b' },
  { token: 'keyword.operator', foreground: '5f5f63' },
  { token: 'type', foreground: '4f6b4f' },
  { token: 'tag', foreground: '4f657c' },
  { token: 'string', foreground: '3f6b4f' },
  { token: 'string.escape', foreground: '8a5a2b' },
  { token: 'number', foreground: '8a5a2b' },
  { token: 'delimiter', foreground: '4a4a4a' },
  { token: 'delimiter.curly', foreground: '8a5a2b' },
  { token: 'delimiter.bracket', foreground: '4f5f73' },
  { token: 'delimiter.parenthesis', foreground: '4f5f73' },
  { token: 'attribute.name', foreground: '8a5a2b' },
  { token: 'attribute.value', foreground: '3f6b4f' },
  { token: 'variable', foreground: '4f657c' },
  { token: 'variable.parameter', foreground: '4f657c' },
  { token: 'constant', foreground: '8a5a2b' },
  { token: 'emphasis', fontStyle: 'italic' },
  { token: 'strong', fontStyle: 'bold' },
];

export const DEXTER_DARK_THEME = 'dexter-obsidian';
export const DEXTER_LIGHT_THEME = 'dexter-paper';

export const MONACO_FONT = "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, monospace";

export function registerDexterThemes(monaco: MonacoThemeApi): void {
  if (registered) return;
  registered = true;
  try {
    monaco.editor.defineTheme(DEXTER_DARK_THEME, {
      base: 'vs-dark',
      inherit: true,
      rules: OBSIDIAN_RULES,
      colors: {
        'editor.background': '#0f0f10',
        'editor.foreground': '#d4d4d4',
        'editorLineNumber.foreground': '#5a5a5e',
        'editorLineNumber.activeForeground': '#d4d4d4',
        'editor.lineHighlightBackground': '#ffffff08',
        'editorCursor.foreground': '#f0f0f0',
        'editor.selectionBackground': '#ffffff2e',
        'editor.inactiveSelectionBackground': '#ffffff18',
        'editorIndentGuide.background1': '#ffffff0f',
        'editorIndentGuide.activeBackground1': '#ffffff33',
        'editorBracketMatch.background': '#ffffff18',
        'editorBracketMatch.border': '#8a8a8e',
        'editorBracketHighlight.foreground1': '#d4d4d4',
        'editorBracketHighlight.foreground2': '#b0b0b0',
        'editorBracketHighlight.foreground3': '#8a8a8e',
        'editorWidget.background': '#18181a',
        'editorWidget.border': '#ffffff14',
        'editorHoverWidget.background': '#18181a',
        'editorHoverWidget.border': '#ffffff14',
        'editorGutter.background': '#0f0f10',
        'diffEditor.insertedTextBackground': '#2f6b4f22',
        'diffEditor.removedTextBackground': '#8a3a3a22',
        'diffEditor.insertedLineBackground': '#2f6b4f12',
        'diffEditor.removedLineBackground': '#8a3a3a12',
        'editor.findMatchBackground': '#ffffff33',
        'editor.findMatchHighlightBackground': '#ffffff1f',
      },
    });
    monaco.editor.defineTheme(DEXTER_LIGHT_THEME, {
      base: 'vs',
      inherit: true,
      rules: PAPER_RULES,
      colors: {
        'editor.background': '#fbfbf9',
        'editor.foreground': '#1a1a1a',
        'editorLineNumber.foreground': '#b0b0aa',
        'editorLineNumber.activeForeground': '#4a4a4a',
        'editor.lineHighlightBackground': '#00000008',
        'editorCursor.foreground': '#141414',
        'editor.selectionBackground': '#14141426',
        'editor.inactiveSelectionBackground': '#14141412',
        'editorWidget.background': '#fbfbf9',
        'editorWidget.border': '#d8d8d2',
        'editorGutter.background': '#fbfbf9',
        'editorBracketHighlight.foreground1': '#1a1a1a',
        'editorBracketHighlight.foreground2': '#4a4a4a',
        'editorBracketHighlight.foreground3': '#7a7a7a',
        'diffEditor.insertedTextBackground': '#2f6b4f22',
        'diffEditor.removedTextBackground': '#8a3a3a22',
        'editor.findMatchBackground': '#14141426',
        'editor.findMatchHighlightBackground': '#14141414',
      },
    });
  } catch {
    registered = false;
  }
}
