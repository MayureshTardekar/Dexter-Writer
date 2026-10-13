// Monaco editor themes matched to the Dexter Write design tokens
// (obsidian dark / clean paper light). Registered once via beforeMount.

interface MonacoThemeApi {
  editor: {
    defineTheme: (name: string, theme: unknown) => void;
  };
}

let registered = false;

const OBSIDIAN_RULES = [
  // Comments: muted italic slate
  { token: 'comment', foreground: '676f83', fontStyle: 'italic' },
  { token: 'comment.doc', foreground: '788299', fontStyle: 'italic' },

  // LaTeX & Programming Keywords / Commands (\documentclass, \usepackage, \begin, \end, \section, \textbf, \item)
  { token: 'keyword', foreground: 'c678dd', fontStyle: 'bold' },
  { token: 'keyword.control', foreground: 'c678dd', fontStyle: 'bold' },
  { token: 'keyword.operator', foreground: '56b6c2' },

  // LaTeX Environments & Types ({document}, {itemize}, {tabular*}, article, Typst types)
  { token: 'type', foreground: 'e5c07b' },
  { token: 'tag', foreground: 'e06c75' },

  // Math equations ($...$, $$...$$) and strings
  { token: 'string', foreground: '98c379' },
  { token: 'string.escape', foreground: '56b6c2' },

  // Numbers & measurements (11pt, 0.7in, 2026, 2)
  { token: 'number', foreground: 'd19a66' },

  // LaTeX & Code Delimiters, Brackets and Parentheses
  { token: 'delimiter', foreground: 'abb2bf' },
  { token: 'delimiter.curly', foreground: 'e5c07b' },
  { token: 'delimiter.bracket', foreground: '61afef' },
  { token: 'delimiter.parenthesis', foreground: '56b6c2' },

  // Variables, parameters, and attributes ([margin=0.7in], [hidelinks])
  { token: 'attribute.name', foreground: 'd19a66' },
  { token: 'attribute.value', foreground: '98c379' },
  { token: 'variable', foreground: 'e06c75' },
  { token: 'variable.parameter', foreground: 'e06c75' },
  { token: 'constant', foreground: 'd19a66' },

  // Text formatting
  { token: 'emphasis', fontStyle: 'italic' },
  { token: 'strong', fontStyle: 'bold' },
];

const PAPER_RULES = [
  { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
  { token: 'comment.doc', foreground: '6a737d', fontStyle: 'italic' },
  { token: 'keyword', foreground: 'd73a49', fontStyle: 'bold' },
  { token: 'keyword.control', foreground: 'd73a49', fontStyle: 'bold' },
  { token: 'keyword.operator', foreground: '005cc5' },
  { token: 'type', foreground: '6f42c1' },
  { token: 'tag', foreground: '22863a' },
  { token: 'string', foreground: '032f62' },
  { token: 'string.escape', foreground: '005cc5' },
  { token: 'number', foreground: '005cc5' },
  { token: 'delimiter', foreground: '444d56' },
  { token: 'delimiter.curly', foreground: '6f42c1' },
  { token: 'delimiter.bracket', foreground: '005cc5' },
  { token: 'attribute.name', foreground: 'e36209' },
  { token: 'attribute.value', foreground: '032f62' },
  { token: 'variable', foreground: 'e36209' },
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
        'editor.background': '#0f1117',
        'editor.foreground': '#abb2bf',
        'editorLineNumber.foreground': '#4b5263',
        'editorLineNumber.activeForeground': '#c8d0e0',
        'editor.lineHighlightBackground': '#282c3435',
        'editorCursor.foreground': '#528bff',
        'editor.selectionBackground': '#3e445166',
        'editor.inactiveSelectionBackground': '#3e445140',
        'editorIndentGuide.background1': '#ffffff0f',
        'editorIndentGuide.activeBackground1': '#528bff33',
        'editorBracketMatch.background': '#515a6b40',
        'editorBracketMatch.border': '#528bff',
        'editorBracketHighlight.foreground1': '#abb2bf',
        'editorBracketHighlight.foreground2': '#56b6c2',
        'editorBracketHighlight.foreground3': '#c678dd',
        'editorWidget.background': '#161922',
        'editorWidget.border': '#ffffff14',
        'editorHoverWidget.background': '#161922',
        'editorHoverWidget.border': '#ffffff14',
        'editorGutter.background': '#0f1117',
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
        'editorBracketHighlight.foreground1': '#444d56',
        'editorBracketHighlight.foreground2': '#005cc5',
        'editorBracketHighlight.foreground3': '#6f42c1',
        'diffEditor.insertedTextBackground': '#0a8a6322',
        'diffEditor.removedTextBackground': '#c93a3a22',
      },
    });
  } catch {
    registered = false;
  }
}
