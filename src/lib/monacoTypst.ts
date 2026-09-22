// Shared Monaco registration for the Typst language (Phase 2 third mode).

interface MonacoLike {
  languages: {
    register(lang: { id: string }): void;
    setMonarchTokensProvider(id: string, def: unknown): void;
  };
}

let registered = false;

export function registerTypstLanguage(monaco: MonacoLike): void {
  if (registered) return;
  registered = true;
  try {
    monaco.languages.register({ id: 'typst' });
    monaco.languages.setMonarchTokensProvider('typst', {
      tokenPostfix: '.typ',
      keywords: ['set', 'show', 'import', 'include', 'let', 'if', 'else', 'for', 'while', 'return', 'context', 'and', 'or', 'not', 'in', 'as'],
      tokenizer: {
        root: [
          [/\/\/.*$/, 'comment'],
          [/\/\*/, 'comment', '@comment'],
          [/^(={1,6})\s.*$/, 'keyword'],
          [/^#{1,6}\s.*$/, 'keyword'],
          [/#[a-zA-Z][\w-]*/, 'type'],
          [/\$[^$\n]*\$/, 'string'],
          [/"/, 'string', '@string'],
          [/\b\d+(\.\d+)?(pt|cm|mm|in|em|deg|%)?\b/, 'number'],
          [/[*_]{1,2}[^*_\n]+[*_]{1,2}/, 'emphasis'],
        ],
        string: [
          [/[^\\"]+/, 'string'],
          [/\\./, 'string.escape'],
          [/"/, 'string', '@pop'],
        ],
        comment: [
          [/[^/*]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[/*]/, 'comment'],
        ],
      },
    });
  } catch {
    registered = false;
  }
}

export function monacoLanguageFor(mode: string): string {
  if (mode === 'latex') return 'latex';
  if (mode === 'typst') return 'typst';
  return 'markdown';
}
