// Dexter Write — Level 3 LaTeX Parser & Macro Expansion Engine
// Handles:
// 1. User macro expansion (\newcommand, \renewcommand, \def, \DeclareMathOperator) with parameter substitution (#1, #2...)
// 2. Balanced nested brace parsing (avoiding regex truncation on nested { { } })
// 3. Tabular parsing with \multicolumn column-span normalization
// 4. Mathematical environment protection and KaTeX compatibility
// 5. Academic environments (abstract, theorem, proof, verbatim, lstlisting)

export interface LatexMacro {
  name: string;
  paramCount: number;
  body: string;
}

/**
 * Extracts balanced curly brace contents starting from the opening '{'.
 * Returns the inner content and the index immediately following the closing '}'.
 */
export function extractBalancedBraces(text: string, startIndex: number): { content: string; endIndex: number } | null {
  const openIdx = text.indexOf('{', startIndex);
  if (openIdx === -1) return null;

  let depth = 1;
  let i = openIdx + 1;
  const len = text.length;

  while (i < len && depth > 0) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2; // skip escaped characters like \{ or \}
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
    }
    i++;
  }

  if (depth === 0) {
    return {
      content: text.slice(openIdx + 1, i - 1),
      endIndex: i,
    };
  }

  return null;
}

/**
 * Removes a LaTeX command TOGETHER WITH its brace arguments (balanced, so
 * nested groups like {\large\bfseries\uppercase} are consumed whole).
 * Without this, fragments like "0em", "colorlinks=true" or "empty" leak
 * into the readable preview. Unbalanced/malformed uses are left untouched.
 */
export function stripLatexCommand(
  src: string,
  name: string,
  argCount: number,
  leadingOpt = false,
  trailingOpt = false,
): string {
  const re = new RegExp(`\\\\${name}\\*?`, 'g');
  let out = '';
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let pos = m.index + m[0].length;
    if (leadingOpt) {
      const opt = /^\s*\[[^\]]*\]/.exec(src.slice(pos));
      if (opt) pos += opt[0].length;
    }
    let ok = true;
    for (let a = 0; a < argCount; a++) {
      const b = extractBalancedBraces(src, pos);
      if (!b) {
        ok = false;
        break;
      }
      pos = b.endIndex;
    }
    if (ok && trailingOpt) {
      const t = /^\s*\[[^\]]*\]/.exec(src.slice(pos));
      if (t) pos += t[0].length;
    }
    if (ok) {
      out += src.slice(idx, m.index);
      idx = pos;
    } else {
      out += src.slice(idx, m.index + m[0].length);
      idx = m.index + m[0].length;
      re.lastIndex = idx;
    }
  }
  return out + src.slice(idx);
}

/**
 * Parses user-defined \newcommand and \def macros from LaTeX preamble and body.
 */
export function extractLatexMacros(tex: string): { macros: Map<string, LatexMacro>; strippedDoc: string } {
  const macros = new Map<string, LatexMacro>();
  let doc = tex;

  // Pattern 1: \newcommand{\name}[N]{body} or \renewcommand{\name}[N]{body} or without [N]
  const newcmdRegex = /\\(?:re)?newcommand\*?\s*\{?\\([a-zA-Z]+)\}?(?:\[(\d+)\])?/g;
  let match: RegExpExecArray | null;

  while ((match = newcmdRegex.exec(doc)) !== null) {
    const fullMatchStart = match.index;
    const name = match[1];
    const paramCount = match[2] ? parseInt(match[2], 10) : 0;
    const afterMatch = fullMatchStart + match[0].length;

    const braces = extractBalancedBraces(doc, afterMatch);
    if (braces) {
      macros.set(name, {
        name,
        paramCount,
        body: braces.content,
      });
      // Replace the definition with whitespace in document so it doesn't render
      doc = doc.slice(0, fullMatchStart) + ' '.repeat(braces.endIndex - fullMatchStart) + doc.slice(braces.endIndex);
      newcmdRegex.lastIndex = fullMatchStart;
    }
  }

  // Pattern 2: \def\name{body}
  const defRegex = /\\def\s*\\([a-zA-Z]+)/g;
  while ((match = defRegex.exec(doc)) !== null) {
    const fullMatchStart = match.index;
    const name = match[1];
    const afterMatch = fullMatchStart + match[0].length;

    const braces = extractBalancedBraces(doc, afterMatch);
    if (braces) {
      macros.set(name, {
        name,
        paramCount: 0,
        body: braces.content,
      });
      doc = doc.slice(0, fullMatchStart) + ' '.repeat(braces.endIndex - fullMatchStart) + doc.slice(braces.endIndex);
      defRegex.lastIndex = fullMatchStart;
    }
  }

  return { macros, strippedDoc: doc };
}

/**
 * Expands user macros in text with argument substitution (#1, #2...) up to a safe recursion limit.
 */
export function expandUserMacros(text: string, macros: Map<string, LatexMacro>, depth = 0): string {
  if (macros.size === 0 || depth > 8) return text;

  let result = text;
  for (const [name, macro] of macros) {
    if (macro.paramCount === 0) {
      // Zero argument macro: replace \name\b or \name{}
      const pattern = new RegExp(`\\\\${name}(?:\\{\\}|\\b)`, 'g');
      if (pattern.test(result)) {
        result = result.replace(pattern, macro.body);
      }
    } else {
      // Macro with arguments: parse each balanced argument
      const callPrefix = `\\${name}`;
      let searchIdx = 0;

      while ((searchIdx = result.indexOf(callPrefix, searchIdx)) !== null && searchIdx !== -1) {
        let cursor = searchIdx + callPrefix.length;
        // Skip whitespace between macro and first arg
        while (cursor < result.length && /\s/.test(result[cursor])) cursor++;

        const args: string[] = [];
        let valid = true;

        for (let p = 0; p < macro.paramCount; p++) {
          while (cursor < result.length && /\s/.test(result[cursor])) cursor++;
          const argBrace = extractBalancedBraces(result, cursor);
          if (argBrace) {
            args.push(argBrace.content);
            cursor = argBrace.endIndex;
          } else {
            valid = false;
            break;
          }
        }

        if (valid) {
          let expanded = macro.body;
          args.forEach((argVal, idx) => {
            const placeholder = new RegExp(`#${idx + 1}`, 'g');
            expanded = expanded.replace(placeholder, argVal);
          });
          result = result.slice(0, searchIdx) + expanded + result.slice(cursor);
          searchIdx += expanded.length;
        } else {
          searchIdx += callPrefix.length;
        }
      }
    }
  }

  return result;
}

/**
 * Transforms LaTeX tabular environments into formatted Markdown GFM tables,
 * with full \multicolumn span expansion and \hline normalization.
 */
export function parseLatexTabular(tabularBody: string): string {
  const cleaned = tabularBody
    .replace(/\\(?:toprule|midrule|bottomrule|hline|cline\{[^}]*\})/g, '')
    .trim();

  const rawRows = cleaned
    .split(/\\\\/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  if (rawRows.length === 0) return '';

  const parsedRows: string[][] = [];

  for (const rawRow of rawRows) {
    const rawCells = rawRow.split('&').map((c) => c.trim());
    const rowCells: string[] = [];

    for (const cell of rawCells) {
      // Check for \multicolumn{N}{align}{content}
      const multicolMatch = /\\multicolumn\s*\{\s*(\d+)\s*\}\s*\{[^}]*\}\s*/.exec(cell);
      if (multicolMatch) {
        const span = parseInt(multicolMatch[1], 10);
        const afterMatch = multicolMatch.index + multicolMatch[0].length;
        const inner = extractBalancedBraces(cell, afterMatch);
        const text = inner ? inner.content.trim() : cell;
        rowCells.push(`**${text}**`);
        // Pad the remaining spanned cells so column counts align
        for (let s = 1; s < span; s++) {
          rowCells.push('');
        }
      } else {
        rowCells.push(cell.replace(/\\\\\$/g, '$').replace(/\\\$/g, '$').replace(/\s+/g, ' '));
      }
    }
    parsedRows.push(rowCells);
  }

  const maxCols = Math.max(...parsedRows.map((r) => r.length), 1);
  const normalizedRows = parsedRows.map((r) => {
    while (r.length < maxCols) r.push('');
    return `| ${r.join(' | ')} |`;
  });

  const header = normalizedRows[0];
  const separator = `| ${Array(maxCols).fill('---').join(' | ')} |`;
  const body = normalizedRows.slice(1);

  return `\n\n${header}\n${separator}\n${body.join('\n')}\n\n`;
}

/**
 * Main Level-3 LaTeX-to-Markdown transformer.
 */
export function parseLatexLevel3(tex: string): string {
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

  // 3. Extract and Expand User Macros (\newcommand, \def, \renewcommand)
  const { macros, strippedDoc } = extractLatexMacros(s);
  s = expandUserMacros(strippedDoc, macros);

  // 4. Escape literal LaTeX symbols (e.g. \$, \&, \%, \_) so they don't trigger math or formatting
  s = s
    .replace(/\\&/g, '&amp;')
    .replace(/\\%/g, '%')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\\$/g, '%%DOLLAR%%');

  // 5. Protect Math Blocks: equation, align, gather, \[ ... \], $$ ... $$, $ ... $
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

  // 6. Convert LaTeX Tables (\begin{tabular} ... \end{tabular}) into Markdown GFM tables with multicolumn support
  s = s.replace(/\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/g, (_m, tableBody) => {
    return parseLatexTabular(tableBody);
  });

  // 7. TikZ and PGF Graphics Card Fallback (protected from generic macro cleanup)
  const tikzBlocks: string[] = [];
  s = s.replace(/\\begin\{tikzpicture\}([\s\S]*?)\\end\{tikzpicture\}/g, (_m, tikzCode) => {
    const idx = tikzBlocks.length;
    tikzBlocks.push(`\n\n> 📐 **TikZ Vector Graphic**\n\`\`\`latex\n\\begin{tikzpicture}${tikzCode}\\end{tikzpicture}\n\`\`\`\n\n`);
    return `%%TIKZBLOCK_${idx}%%`;
  });

  // 8. Structure & Document environments
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

  // 8b. Preamble layout & styling commands carry no readable text — remove
  // them WITH their arguments, otherwise fragments like "0em[] 0pt12pt4pt",
  // "colorlinks=true" or "empty" leak into the preview.
  s = stripLatexCommand(s, 'titlespacing', 4, false, true);
  s = stripLatexCommand(s, 'titleformat', 5, true, true);
  s = stripLatexCommand(s, 'hypersetup', 1);
  s = s
    .replace(/\\pagestyle\{[^}]*\}/g, '')
    .replace(/\\thispagestyle\{[^}]*\}/g, '')
    .replace(/\\pagenumbering\{[^}]*\}/g, '')
    .replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, (_m, inner) => `\n\n${String(inner).trim()}\n\n`);

  // 9. Academic Environments (abstract, quote, theorem, proof)
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

  // 10. Lists: itemize and enumerate (consume enumitem-style [options] too,
  // otherwise they leak into the readable preview as raw "[nosep, ...]" text)
  s = s
    .replace(/\\begin\{itemize\}(?:\[[^\]]*\])?/g, '')
    .replace(/\\end\{itemize\}/g, '')
    .replace(/\\begin\{enumerate\}(?:\[[^\]]*\])?/g, '')
    .replace(/\\end\{enumerate\}/g, '')
    .replace(/\\item\s*/g, '- ');

  // 10b. Spacing commands carry no readable text — drop them WITH their
  // arguments, otherwise lengths like "{4pt}" leak into the preview as "4pt".
  s = s.replace(/\\(?:vspace|hspace|smallskip|medskip|bigskip|noindent|indent)\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, '');

  // 11. Typography, styles, links, and citations with balanced brace handling
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

  // 12. Figures and Graphics
  s = s.replace(/\\begin\{figure\}[\s\S]*?\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}[\s\S]*?(?:\\caption\{([^}]*)\})?[\s\S]*?\\end\{figure\}/g, (_m, path, caption) => {
    return `\n\n![${caption || 'Figure'}](${path})\n*${caption || ''}*\n\n`;
  });

  // 13. Generic cleanup of remaining unrecognized single macros (\centering, \small, etc.)
  s = s
    .replace(/\\[a-zA-Z]+(?:\*|\b)(?:\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '');

  // 14. Restore Code Blocks, TikZ, and Escaped Symbols
  s = s.replace(/%%CODEBLOCK_(\d+)%%/g, (_m, idx) => codeBlocks[Number(idx)] || '');
  s = s.replace(/%%TIKZBLOCK_(\d+)%%/g, (_m, idx) => tikzBlocks[Number(idx)] || '');
  s = s.replace(/%%DOLLAR%%/g, '$');

  // 15. Restore Protected Math Blocks (so KaTeX receives exact original formulas!)
  s = s.replace(/%%MATHBLOCK_(\d+)%%/g, (_m, idx) => mathBlocks[Number(idx)] || '');

  return s.replace(/\n{3,}/g, '\n\n').trim();
}
