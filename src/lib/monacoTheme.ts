// Monaco editor themes matched to the Dexter Write design tokens
// (obsidian dark / clean paper light). Registered once via beforeMount.

interface MonacoThemeApi {
  editor: {
    defineTheme: (name: string, theme: unknown) => void;
  };
}

let registered = false;

const OBSIDIAN_RULES = [
  { token: 'comment', foreground: '5b6478', fontStyle: 'italic' },
  { token: 'keyword', foreground: '8b5cf6', fontStyle: 'bold' },
  { token: 'string', foreground: '34d3a6' },
  { token: 'number', foreground: 'e8b23f' },
  { token: 'type', foreground: '22d3ee' },
  { token: 'emphasis', fontStyle: 'italic' },
];

const PAPER_RULES = [
  { token: 'comment', foreground: '8b93a8', fontStyle: 'italic' },
  { token: 'keyword', foreground: '4f46e5', fontStyle: 'bold' },
  { token: 'string', foreground: '0a8a63' },
  { token: 'number', foreground: 'a86e00' },
  { token: 'type', foreground: '0e7490' },
  { token: 'emphasis', fontStyle: 'italic' },
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
        'editor.background': '#0d1017',
        'editor.foreground': '#eef1f9',
        'editorLineNumber.foreground': '#454e66',
        'editorLineNumber.activeForeground': '#9aa5c0',
        'editor.lineHighlightBackground': '#141824',
        'editorCursor.foreground': '#8b5cf6',
        'editor.selectionBackground': '#6366f140',
        'editor.inactiveSelectionBackground': '#6366f128',
        'editorIndentGuide.background1': '#ffffff0d',
        'editorIndentGuide.activeBackground1': '#ffffff1f',
        'editorWidget.background': '#141824',
        'editorWidget.border': '#ffffff14',
        'editorHoverWidget.background': '#141824',
        'editorHoverWidget.border': '#ffffff14',
        'editorGutter.background': '#0d1017',
        'diffEditor.insertedTextBackground': '#34d3a622',
        'diffEditor.removedTextBackground': '#f26d6d22',
        'diffEditor.insertedLineBackground': '#34d3a612',
        'diffEditor.removedLineBackground': '#f26d6d12',
        'editor.findMatchBackground': '#8b5cf655',
        'editor.findMatchHighlightBackground': '#8b5cf633',
      },
    });
    monaco.editor.defineTheme(DEXTER_LIGHT_THEME, {
      base: 'vs',
      inherit: true,
      rules: PAPER_RULES,
      colors: {
        'editor.background': '#fdfcf8',
        'editor.foreground': '#191c26',
        'editorLineNumber.foreground': '#a8aec0',
        'editorLineNumber.activeForeground': '#5a6480',
        'editor.lineHighlightBackground': '#f0ede3',
        'editorCursor.foreground': '#4f46e5',
        'editor.selectionBackground': '#4f46e533',
        'editor.inactiveSelectionBackground': '#4f46e522',
        'editorWidget.background': '#fdfcf8',
        'editorWidget.border': '#ddd6c4',
        'editorGutter.background': '#fdfcf8',
        'diffEditor.insertedTextBackground': '#0a8a6322',
        'diffEditor.removedTextBackground': '#c93a3a22',
      },
    });
  } catch {
    registered = false;
  }
}
