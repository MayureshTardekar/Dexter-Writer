import type { DocMode } from './templates';

export interface OutlineItem {
  title: string;
  level: number;
  line: number;
}

export interface DocStats {
  words: number;
  chars: number;
  lines: number;
  readingTimeMin: number;
}

export function getDocumentOutline(content: string, mode: DocMode): OutlineItem[] {
  const lines = content.split('\n');
  const out: OutlineItem[] = [];
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    if (mode === 'markdown') {
      const m = /^(#{1,6})\s+(.+)$/.exec(raw.trim());
      if (m) {
        out.push({ title: m[2].replace(/\*\*/g, '').slice(0, 120), level: m[1].length, line });
      }
    } else if (mode === 'typst') {
      const m = /^(={1,6})\s+(.+)$/.exec(raw.trim());
      if (m) {
        out.push({ title: m[2].replace(/[*_]/g, '').slice(0, 120), level: m[1].length, line });
      }
    } else {
      const sec = /\\(section|subsection|subsubsection|chapter|paragraph)\*?\{([^}]+)\}/.exec(raw);
      if (sec) {
        const lvl = sec[1] === 'chapter' ? 1 : sec[1] === 'section' ? 1 : sec[1] === 'subsection' ? 2 : 3;
        out.push({ title: sec[2].slice(0, 120), level: lvl, line });
      }
    }
  });
  return out.slice(0, 500);
}

export function getDocStats(content: string): DocStats {
  const lines = content ? content.split('\n').length : 0;
  const chars = content.length;
  const words = (content.trim().match(/\S+/g) ?? []).length;
  return { words, chars, lines, readingTimeMin: Math.max(1, Math.ceil(words / 200)) };
}

export function stripToPlainText(content: string, mode: DocMode): string {
  let t = content;
  if (mode === 'latex') {
    t = t
      .replace(/%.*$/gm, '')
      .replace(/\\(begin|end)\{[^}]*\}/g, '')
      .replace(/\\(section|subsection|subsubsection|chapter|title|author|date|maketitle)[*]?(\[[^\]]*\])?(\{[^}]*\})?/g, '\n$3\n')
      .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{([^}]*)\})?/g, '$3')
      .replace(/[{}]/g, '');
  } else {
    t = t
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/^>\s?/gm, '')
      .replace(/^[-*]\s+\[[ xX]\]\s+/gm, '');
  }
  if (mode === 'typst') {
    t = t
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/^#(set|show|import|include|let|context|if|for|while|return)\b.*$/gm, '')
      .replace(/^={1,6}\s+/gm, '')
      .replace(/#(figure|cite|ref|label|footnote|bibliography|table|align|grid|stack|block|box|footnote|link)\b[^\n]*/g, '')
      .replace(/#([a-zA-Z][\w-]*)/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1');
  }
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

/** Convert LaTeX source into readable markdown-ish text for preview. */
/** Convert LaTeX source into readable, rich markdown-ish text for live preview. */
export function latexToReadable(tex: string): string {
  if (!tex || !tex.trim()) return '';

  // 1. Remove comments (except escaped \%)
  let s = tex.replace(/(^|[^\\])%.*$/gm, '$1');

  // 2. Protect Code Blocks: verbatim & lstlisting
  const codeBlocks: string[] = [];
  s = s.replace(/\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/g, (_m, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`\`\`\`\n${code.trim()}\n\`\`\``);
    return `%%CODEBLOCK_${idx}%%`;
  });
  s = s.replace(/\\begin\{lstlisting\}(?:\[([^\]]*)\])?([\s\S]*?)\\end\{lstlisting\}/g, (_m, opt, code) => {
    const langMatch = opt ? /language=([a-zA-Z0-9#+]+)/i.exec(opt) : null;
    const lang = langMatch ? langMatch[1].toLowerCase() : '';
    const idx = codeBlocks.length;
    codeBlocks.push(`\`\`\`${lang}\n${code.trim()}\n\`\`\``);
    return `%%CODEBLOCK_${idx}%%`;
  });

  // 3. Escape literal LaTeX symbols (e.g. \$, \&, \%, \_) so they don't trigger math or formatting
  s = s
    .replace(/\\&/g, '&amp;')
    .replace(/\\%/g, '%')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\\$/g, '%%DOLLAR%%');

  // 4. Protect Math Blocks: equation, align, gather, \[ ... \], $$ ... $$, $ ... $
  const mathBlocks: string[] = [];
  const protectMath = (inner: string, isBlock: boolean) => {
    const idx = mathBlocks.length;
    const trimmed = inner.trim();
    if (isBlock) {
      mathBlocks.push(`\n\n$$\n${trimmed}\n$$\n\n`);
    } else {
      mathBlocks.push(`$${trimmed}$`);
    }
    return `%%MATHBLOCK_${idx}%%`;
  };

  // Block math: \begin{equation*?}, \begin{align*?}, \begin{gather*?}, \[ ... \], $$ ... $$
  s = s.replace(/\\begin\{(?:equation|displaymath)\*?\}([\s\S]*?)\\end\{(?:equation|displaymath)\*?\}/g, (_m, math) => protectMath(math, true));
  s = s.replace(/\\begin\{(?:align|aligned|gather|multline)\*?\}([\s\S]*?)\\end\{(?:align|aligned|gather|multline)\*?\}/g, (_m, math) => {
    return protectMath(`\\begin{aligned}${math}\\end{aligned}`, true);
  });
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_m, math) => protectMath(math, true));
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_m, math) => protectMath(math, true));

  // Inline math: $ ... $ (must not be empty, not spanning across newlines, not escaped)
  s = s.replace(/(?<!\\)\$(?!\$)([^$\n]+?)(?<!\\)\$/g, (_m, math) => protectMath(math, false));

  // 4. Convert LaTeX Tables (\begin{tabular} ... \end{tabular}) into Markdown GFM tables
  s = s.replace(/\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/g, (_m, tableBody) => {
    const rawRows = tableBody
      .replace(/\\hline|\\toprule|\\midrule|\\bottomrule/g, '')
      .split(/\\\\/)
      .map((r: string) => r.trim())
      .filter((r: string) => r.length > 0);

    if (rawRows.length === 0) return '';

    const rows = rawRows.map((r: string) =>
      r.split('&').map((cell: string) => cell.trim().replace(/\s+/g, ' '))
    );

    const maxCols = Math.max(...rows.map((r: string[]) => r.length), 1);
    const normalizedRows = rows.map((r: string[]) => {
      while (r.length < maxCols) r.push('');
      return `| ${r.join(' | ')} |`;
    });

    const header = normalizedRows[0];
    const separator = `| ${Array(maxCols).fill('---').join(' | ')} |`;
    const body = normalizedRows.slice(1);

    return `\n\n${header}\n${separator}\n${body.join('\n')}\n\n`;
  });

  // 5. Structure & Document environments
  s = s
    .replace(/\\documentclass(\[[^\]]*\])?\{[^}]*\}\n?/g, '')
    .replace(/\\usepackage(\[[^\]]*\])?\{[^}]*\}\n?/g, '')
    .replace(/\\begin\{document\}/g, '')
    .replace(/\\end\{document\}/g, '')
    .replace(/\\maketitle/g, '')
    .replace(/\\title\{([^}]*)\}/g, '# $1\n')
    .replace(/\\author\{([^}]*)\}/g, '*$1*\n')
    .replace(/\\date\{([^}]*)\}/g, '*$1*\n')
    .replace(/\\chapter\*?\{([^}]*)\}/g, '# $1\n')
    .replace(/\\section\*?\{([^}]*)\}/g, '## $1\n')
    .replace(/\\subsection\*?\{([^}]*)\}/g, '### $1\n')
    .replace(/\\subsubsection\*?\{([^}]*)\}/g, '#### $1\n')
    .replace(/\\paragraph\*?\{([^}]*)\}/g, '**$1** — ');

  // 6. Academic Environments (abstract, quote, theorem, proof)
  s = s.replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g, (_m, abs) => {
    const lines = abs.trim().split('\n').map((l: string) => `> ${l.trim()}`).join('\n');
    return `\n\n> **Abstract**  \n${lines}\n\n`;
  });
  s = s.replace(/\\begin\{quote\}([\s\S]*?)\\end\{quote\}/g, (_m, q) => {
    return q.trim().split('\n').map((l: string) => `> ${l}`).join('\n');
  });
  s = s.replace(/\\begin\{theorem\}(?:\[([^\]]*)\])?([\s\S]*?)\\end\{theorem\}/g, (_m, opt, thm) => {
    const title = opt ? ` (${opt})` : '';
    return `\n\n> **Theorem${title}.** *${thm.trim()}*\n\n`;
  });
  s = s.replace(/\\begin\{proof\}([\s\S]*?)\\end\{proof\}/g, (_m, prf) => {
    return `\n\n*Proof.* ${prf.trim()} ∎\n\n`;
  });

  // 7. Lists: itemize and enumerate
  s = s
    .replace(/\\begin\{itemize\}/g, '')
    .replace(/\\end\{itemize\}/g, '')
    .replace(/\\begin\{enumerate\}/g, '')
    .replace(/\\end\{enumerate\}/g, '')
    .replace(/\\item\s*/g, '- ');

  // 8. Typography, styles, links, and citations
  s = s
    .replace(/\\textbf\{([^}]*)\}/g, '**$1**')
    .replace(/\\textit\{([^}]*)\}/g, '*$1*')
    .replace(/\\emph\{([^}]*)\}/g, '*$1*')
    .replace(/\\texttt\{([^}]*)\}/g, '`$1`')
    .replace(/\\underline\{([^}]*)\}/g, '<u>$1</u>')
    .replace(/\\textsc\{([^}]*)\}/g, '<span style="font-variant:small-caps">$1</span>')
    .replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, '[$2]($1)')
    .replace(/\\url\{([^}]*)\}/g, '[$1]($1)')
    .replace(/\\cite\{([^}]*)\}/g, '[$1]')
    .replace(/\\citep\{([^}]*)\}/g, '($1)')
    .replace(/\\citet\{([^}]*)\}/g, '$1')
    .replace(/\\ref\{([^}]*)\}/g, '$1')
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/\\footnote\{([^}]*)\}/g, ' *($1)*')
    .replace(/\\(newpage|clearpage)/g, '\n\n---\n\n')
    .replace(/\\hrulefill|\\rule\{[^}]*\}\{[^}]*\}/g, '\n\n---\n\n')
    .replace(/\\\\(\[[^\]]*\])?/g, '\n');

  // 9. Figures and Graphics
  s = s.replace(/\\begin\{figure\}[\s\S]*?\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}[\s\S]*?(?:\\caption\{([^}]*)\})?[\s\S]*?\\end\{figure\}/g, (_m, path, caption) => {
    return `\n\n![${caption || 'Figure'}](${path})\n*${caption || ''}*\n\n`;
  });

  // 10. Generic cleanup of remaining unrecognized single macros (\centering, \small, etc.)
  s = s
    .replace(/\\[a-zA-Z]+(?:\*|\b)(?:\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '');

  // 11. Restore Code Blocks and Escaped Symbols
  s = s.replace(/%%CODEBLOCK_(\d+)%%/g, (_m, idx) => codeBlocks[Number(idx)] || '');
  s = s.replace(/%%DOLLAR%%/g, '$');

  // 12. Restore Protected Math Blocks (so KaTeX receives exact original formulas!)
  s = s.replace(/%%MATHBLOCK_(\d+)%%/g, (_m, idx) => mathBlocks[Number(idx)] || '');

  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/** Convert Typst source into readable markdown-ish text (fallback preview). */
export function typstToReadable(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/^#(set|show|import|include)\b.*$/gm, '')
    .replace(/^(={1,6})\s+(.+)$/gm, (_m, eq: string, title: string) => `${'#'.repeat(eq.length)} ${title}`)
    .replace(/^#align\([^)]*\)\[(.+)\]$/gm, '$1')
    .replace(/#(v|h|line|pagebreak|bibliography)\([^)]*\)/g, '')
    .replace(/#text\([^)]*\)\[(.+?)\]/g, '$1')
    .replace(/#datetime[^\n]*/g, '')
    .replace(/#([a-zA-Z][\w-]*)/g, '$1');
}
