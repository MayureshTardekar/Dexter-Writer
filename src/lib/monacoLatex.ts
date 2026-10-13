// Shared Monaco registration for LaTeX.
//
// monaco-editor ships NO latex grammar: with language="latex" and no
// tokenizer, buffers emit zero tokens and render single-color (this was the
// "black text" bug — no theme can fix what the tokenizer never emits).
// Token names mirror the dexter-obsidian / dexter-paper theme rules so every
// rule actually fires in both modes.

interface MonacoLike {
  languages: {
    register(lang: { id: string }): void;
    setMonarchTokensProvider(id: string, def: unknown): void;
    setLanguageConfiguration?(id: string, config: unknown): void;
  };
}

let registered = false;

export function registerLatexLanguage(monaco: MonacoLike): void {
  if (registered) return;
  registered = true;
  try {
    monaco.languages.register({ id: 'latex' });
    monaco.languages.setMonarchTokensProvider('latex', {
      tokenPostfix: '.tex',
      tokenizer: {
        root: [
          // Escaped specials (\%, \$, \&…) must come before comment/math rules
          [/\\[%$&#_{}]/, 'string.escape'],
          // Comments (bare % only — \% is handled above)
          [/%.*$/, 'comment'],
          // Display math $$...$$ (own state, may span lines)
          [/\$\$/, 'string', '@mathdisplay'],
          // Inline math $...$ (state so $...$ pairs colorize, not just delimiters)
          [/\$/, 'string', '@mathinline'],
          // Structural commands get the emphasized control token
          [/\\(documentclass|usepackage|begin|end|section|subsection|subsubsection|paragraph|chapter|title|author|date|maketitle|tableofcontents)\b/, 'keyword.control'],
          // All other commands (\textbf, \item, \href, \cite, …)
          [/\\[a-zA-Z@]+\*?/, 'keyword'],
          // Delimiters (theme distinguishes curly/bracket/paren)
          [/[{}]/, 'delimiter.curly'],
          [/[[\]]/, 'delimiter.bracket'],
          [/[()]/, 'delimiter.parenthesis'],
          // Numbers with TeX units (11pt, 0.7in, 2026, 1.5cm)
          [/\b\d+(\.\d+)?(pt|pc|in|bp|cm|mm|dd|cc|nd|nc|sp|ex|em|%)?\b/, 'number'],
          // Alignment tab & non-breaking space
          [/[&~]/, 'keyword.operator'],
        ],
        mathinline: [
          [/[^$\\%]+/, 'string'],
          [/\\[%$&#_{}]/, 'string.escape'],
          [/\\./, 'string.escape'],
          [/\$/, 'string', '@pop'],
          [/[^$]/, 'string'],
        ],
        mathdisplay: [
          [/\$\$/, 'string', '@pop'],
          [/[^$\\%]+/, 'string'],
          [/\\[%$&#_{}]/, 'string.escape'],
          [/\\./, 'string.escape'],
          [/\$/, 'string'],
        ],
      },
    });
    // Line comments (%) + auto-closing pairs: enables Ctrl+/ toggle-comment
    // and makes the editor feel LaTeX-aware, not just colored.
    monaco.languages.setLanguageConfiguration?.('latex', {
      comments: { lineComment: '%' },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '$', close: '$', notIn: ['string', 'comment'] },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '$', close: '$' },
      ],
    });
  } catch {
    registered = false;
  }
}
