// Dexter Write — Level 3 LaTeX Parser & Macro Expansion Engine
// Handles:
// 1. Jake's Resume template commands (\resumeSubheading, \resumeProjectHeading, \resumeItem, etc.)
// 2. User macro expansion (\newcommand, \renewcommand, \def) with parameter substitution (#1, #2...)
// 3. Balanced nested brace parsing
// 4. Tabular parsing with \multicolumn column-span normalization
// 5. Mathematical environment protection and KaTeX compatibility
// 6. Academic environments (abstract, theorem, proof, verbatim, lstlisting)

export interface LatexMacro {
  name: string;
  paramCount: number;
  body: string;
}

/**
 * Extracts balanced curly brace contents starting from the opening '{'.
 */
export function extractBalancedBraces(text: string, startIndex: number): { content: string; endIndex: number } | null {
  const openIdx = text.indexOf('{', startIndex);
  if (openIdx === -1) return null;
  let depth = 1;
  let i = openIdx + 1;
  const len = text.length;
  while (i < len && depth > 0) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth === 0) return { content: text.slice(openIdx + 1, i - 1), endIndex: i };
  return null;
}

/**
 * Removes a LaTeX command together with its brace arguments.
 */
export function stripLatexCommand(
  src: string, name: string, argCount: number, leadingOpt = false, trailingOpt = false,
): string {
  const re = new RegExp(`\\\\${name}\\*?`, 'g');
  let out = ''; let idx = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let pos = m.index + m[0].length;
    if (leadingOpt) { const opt = /^\s*\[[^\]]*\]/.exec(src.slice(pos)); if (opt) pos += opt[0].length; }
    let ok = true;
    for (let a = 0; a < argCount; a++) {
      const b = extractBalancedBraces(src, pos);
      if (!b) { ok = false; break; }
      pos = b.endIndex;
    }
    if (ok && trailingOpt) { const t = /^\s*\[[^\]]*\]/.exec(src.slice(pos)); if (t) pos += t[0].length; }
    if (ok) { out += src.slice(idx, m.index); idx = pos; }
    else { out += src.slice(idx, m.index + m[0].length); idx = m.index + m[0].length; re.lastIndex = idx; }
  }
  return out + src.slice(idx);
}

/**
 * Parses user-defined \newcommand and \def macros from LaTeX preamble and body.
 */
export function extractLatexMacros(tex: string): { macros: Map<string, LatexMacro>; strippedDoc: string } {
  const macros = new Map<string, LatexMacro>();
  let doc = tex;
  const newcmdRegex = /\\(?:re)?newcommand\*?\s*\{?\\([a-zA-Z]+)\}?(?:\[(\d+)\])?/g;
  let match: RegExpExecArray | null;
  while ((match = newcmdRegex.exec(doc)) !== null) {
    const fullMatchStart = match.index;
    const name = match[1];
    const paramCount = match[2] ? parseInt(match[2], 10) : 0;
    const afterMatch = fullMatchStart + match[0].length;
    const braces = extractBalancedBraces(doc, afterMatch);
    if (braces) {
      macros.set(name, { name, paramCount, body: braces.content });
      doc = doc.slice(0, fullMatchStart) + ' '.repeat(braces.endIndex - fullMatchStart) + doc.slice(braces.endIndex);
      newcmdRegex.lastIndex = fullMatchStart;
    }
  }
  const defRegex = /\\def\s*\\([a-zA-Z]+)/g;
  while ((match = defRegex.exec(doc)) !== null) {
    const fullMatchStart = match.index;
    const name = match[1];
    const afterMatch = fullMatchStart + match[0].length;
    const braces = extractBalancedBraces(doc, afterMatch);
    if (braces) {
      macros.set(name, { name, paramCount: 0, body: braces.content });
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
      const pattern = new RegExp(`\\\\${name}(?:\\{\\}|\\b)`, 'g');
      if (pattern.test(result)) result = result.replace(pattern, macro.body);
    } else {
      const callPrefix = `\\${name}`;
      let searchIdx = 0;
      while ((searchIdx = result.indexOf(callPrefix, searchIdx)) !== null && searchIdx !== -1) {
        // Never match a LONGER macro name that merely starts with this one
        // (e.g. \resumeItem must not match inside \resumeItemListStart).
        const afterName = result[searchIdx + callPrefix.length] ?? '';
        if (/[a-zA-Z]/.test(afterName)) {
          searchIdx += callPrefix.length;
          continue;
        }
        let cursor = searchIdx + callPrefix.length;
        while (cursor < result.length && /\s/.test(result[cursor])) cursor++;
        const args: string[] = [];
        let valid = true;
        for (let p = 0; p < macro.paramCount; p++) {
          while (cursor < result.length && /\s/.test(result[cursor])) cursor++;
          // The argument's opening brace must be adjacent — never scan ahead,
          // or an unrelated later group (e.g. {document}) gets swallowed.
          if (result[cursor] !== '{') {
            valid = false;
            break;
          }
          const argBrace = extractBalancedBraces(result, cursor);
          if (argBrace) { args.push(argBrace.content); cursor = argBrace.endIndex; }
          else { valid = false; break; }
        }
        if (valid) {
          let expanded = macro.body;
          args.forEach((argVal, idx) => { expanded = expanded.replace(new RegExp(`#${idx + 1}`, 'g'), argVal); });
          result = result.slice(0, searchIdx) + expanded + result.slice(cursor);
          searchIdx += expanded.length;
        } else { searchIdx += callPrefix.length; }
      }
    }
  }
  return result;
}

/**
 * Finds tabular/tabular* environments and converts each body with
 * parseLatexTabular. The preamble (optional {width}, [pos], and the column
 * spec which may nest braces like @{...}) is consumed with balanced parsing.
 * Malformed environments are left untouched for generic cleanup downstream.
 */
export function convertTabularEnvs(s: string): string {
  const openRe = /\\begin\{tabular\*?\}/g;
  let out = '';
  let idx = 0;
  let m: RegExpExecArray | null;
  const skipPast = (pos: number): void => {
    openRe.lastIndex = pos;
  };
  while ((m = openRe.exec(s)) !== null) {
    const starred = m[0].includes('*');
    const closeTag = starred ? '\\end{tabular*}' : '\\end{tabular}';
    let pos = m.index + m[0].length;
    let valid = true;
    // Preamble groups: optional {width}, optional [pos], required {colspec}.
    // A lone {group} is the colspec itself (NOT a width) — this mirrors the
    // old regex's backtracking. Width only counts when another group follows.
    const takeGroup = (): boolean => {
      if (s[pos] !== '{') return false;
      const b = extractBalancedBraces(s, pos);
      if (!b) return false;
      pos = b.endIndex;
      return true;
    };
    const takeOpt = (): void => {
      const opt = /^\s*\[[^\]]*\]/.exec(s.slice(pos));
      if (opt) pos += opt[0].length;
    };
    if (s[pos] === '{') {
      if (!takeGroup()) valid = false;
      else {
        const afterFirst = pos;
        takeOpt();
        if (s[pos] === '{') {
          if (!takeGroup()) valid = false;
        } else {
          pos = afterFirst; // single group was the colspec
        }
      }
    } else {
      takeOpt();
      if (!takeGroup()) valid = false;
    }
    const closeIdx = valid ? s.indexOf(closeTag, pos) : -1;
    if (!valid || closeIdx === -1) {
      skipPast(m.index + m[0].length);
      continue;
    }
    const body = s.slice(pos, closeIdx);
    out += s.slice(idx, m.index) + parseLatexTabular(body);
    idx = closeIdx + closeTag.length;
    openRe.lastIndex = idx;
  }
  return out + s.slice(idx);
}

/**
 * Transforms LaTeX tabular environments into formatted Markdown GFM tables.
 */
export function parseLatexTabular(tabularBody: string): string {
  const cleaned = tabularBody.replace(/\\(?:toprule|midrule|bottomrule|hline|cline\{[^}]*\})/g, '').trim();
  const rawRows = cleaned.split(/\\\\/).map((r) => r.trim()).filter((r) => r.length > 0);
  if (rawRows.length === 0) return '';
  const parsedRows: string[][] = [];
  for (const rawRow of rawRows) {
    const rawCells = rawRow.split('&').map((c) => c.trim());
    const rowCells: string[] = [];
    for (const cell of rawCells) {
      const multicolMatch = /\\multicolumn\s*\{\s*(\d+)\s*\}\s*\{[^}]*\}\s*/.exec(cell);
      if (multicolMatch) {
        const span = parseInt(multicolMatch[1], 10);
        const afterMatch = multicolMatch.index + multicolMatch[0].length;
        const inner = extractBalancedBraces(cell, afterMatch);
        const text = inner ? inner.content.trim() : cell;
        rowCells.push(`**${text}**`);
        for (let s = 1; s < span; s++) rowCells.push('');
      } else {
        rowCells.push(cell.replace(/\\\\\$/g, '$').replace(/\\\$/g, '$').replace(/\s+/g, ' '));
      }
    }
    parsedRows.push(rowCells);
  }
  const maxCols = Math.max(...parsedRows.map((r) => r.length), 1);
  if (parsedRows.length <= 3 && maxCols === 2 && !tabularBody.includes('\\hline')) {
    return '\n\n' + parsedRows.map((cols) => {
      const left = (cols[0] || '').trim();
      const right = (cols[1] || '').trim();
      if (left && right) return `${left} &mdash; *${right.replace(/^\*|\*$/g, '')}*`;
      return left || right;
    }).join('  \n') + '\n\n';
  }
  const normalizedRows = parsedRows.map((r) => { while (r.length < maxCols) r.push(''); return `| ${r.join(' | ')} |`; });
  const header = normalizedRows[0];
  const separator = `| ${Array(maxCols).fill('%%TABLE_SEP%%').join(' | ')} |`;
  const body = normalizedRows.slice(1);
  return `\n\n${header}\n${separator}\n${body.join('\n')}\n\n`;
}

// ─── Jake's Resume Template Parsing ──────────────────────────────────────────
//
// These are the STANDARD Jake's Resume template commands. We intercept them
// before generic macro expansion so we can emit proper HTML structure.
// This produces a two-column layout matching Overleaf's PDF output exactly.

/**
 * Converts inline LaTeX formatting to markdown-compatible HTML.
 * Used on text fragments inside Jake's template command arguments.
 */
function inlineLatexToHtml(text: string): string {
  let s = text.trim();
  // math pipes used as dividers $|$
  s = s.replace(/\$\s*\|\s*\$/g, ' | ');
  // inline math
  s = s.replace(/(?<!\\)\$(?!\$)([^$\n]+?)(?<!\\)\$/g, (_m, math) => `$${math}$`);
  // bold + italic combo
  s = s.replace(/\\textbf\{\\textit\{([^}]*)\}\}/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\\textit\{\\textbf\{([^}]*)\}\}/g, '<strong><em>$1</em></strong>');
  // bold, italic, emph, small, sc
  s = s.replace(/\\textbf\{([^}]*)\}/g, '<strong>$1</strong>');
  s = s.replace(/\\textit\{([^}]*)\}/g, '<em>$1</em>');
  s = s.replace(/\\emph\{([^}]*)\}/g, '<em>$1</em>');
  s = s.replace(/\\texttt\{([^}]*)\}/g, '<code>$1</code>');
  s = s.replace(/\\small\{([^}]*)\}/g, '<small>$1</small>');
  s = s.replace(/\\scshape\s*/g, '');
  s = s.replace(/\\Huge\s*/g, '');
  s = s.replace(/\\Large\s*/g, '');
  s = s.replace(/\\large\s*/g, '');
  s = s.replace(/\\small\s*/g, '');
  // links
  s = s.replace(/\\href\{([^}]*)\}\{\\underline\{([^}]*)\}\}/g, '<a href="$1">$2</a>');
  s = s.replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, '<a href="$1">$2</a>');
  s = s.replace(/\\underline\{([^}]*)\}/g, '<u>$1</u>');
  s = s.replace(/\\url\{([^}]*)\}/g, '<a href="$1">$1</a>');
  // dashes
  s = s.replace(/---/g, '—');
  s = s.replace(/--/g, '–');
  // escaped chars
  s = s.replace(/\\&/g, '&amp;');
  s = s.replace(/\\%/g, '%');
  s = s.replace(/\\\$/g, '$');
  s = s.replace(/\\_/g, '_');
  s = s.replace(/\\#/g, '#');
  // vspace, hspace etc — strip
  s = s.replace(/\\\\(?:vspace|hspace|enspace|thinspace|kern)\*?(?:\{[^}]*\})?/g, ' ');
  s = s.replace(/\\\\(?:qquad|quad)\b/g, ' · ');
  s = s.replace(/\\(?:small|large|Large|huge|Huge|normalsize|footnotesize|scriptsize)\b/g, '');
  // strip remaining single-arg commands but keep content
  s = s.replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1');
  // strip remaining bare commands
  s = s.replace(/\\[a-zA-Z]+\s*/g, '');
  // clean braces
  s = s.replace(/[{}]/g, '');
  return s.trim();
}

/**
 * Parses Jake's Resume \resumeSubheading{name}{location}{role}{dates}
 * and emits an HTML div with two-column layout (name|location, role|dates).
 */
export function parseResumeSubheading(src: string): string {
  let result = src;
  // Match \resumeSubheading and consume 4 brace-balanced args
  const re = /\\resumeSubheading\b/g;
  let m: RegExpExecArray | null;
  const replacements: Array<{ start: number; end: number; html: string }> = [];
  while ((m = re.exec(result)) !== null) {
    let pos = m.index + m[0].length;
    const args: string[] = [];
    let ok = true;
    for (let i = 0; i < 4; i++) {
      while (pos < result.length && /[\s\n]/.test(result[pos])) pos++;
      if (result[pos] !== '{') { ok = false; break; }
      const b = extractBalancedBraces(result, pos);
      if (!b) { ok = false; break; }
      args.push(b.content);
      pos = b.endIndex;
    }
    if (ok && args.length === 4) {
      const [name, location, role, dates] = args.map(inlineLatexToHtml);
      const html = `\n<div class="resume-subheading"><div class="resume-sh-row1"><span class="resume-sh-name">${name}</span><span class="resume-sh-loc">${location}</span></div><div class="resume-sh-row2"><span class="resume-sh-role">${role}</span><span class="resume-sh-dates">${dates}</span></div></div>\n`;
      replacements.push({ start: m.index, end: pos, html });
    }
  }
  // Apply replacements in reverse so indices don't shift
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.slice(0, r.start) + r.html + result.slice(r.end);
  }
  return result;
}

/**
 * Parses \resumeProjectHeading{title}{year} and emits project heading HTML.
 * Title is typically: \textbf{Name} $|$ \emph{tech1, tech2}
 */
export function parseResumeProjectHeading(src: string): string {
  let result = src;
  const re = /\\resumeProjectHeading\b/g;
  let m: RegExpExecArray | null;
  const replacements: Array<{ start: number; end: number; html: string }> = [];
  while ((m = re.exec(result)) !== null) {
    let pos = m.index + m[0].length;
    const args: string[] = [];
    let ok = true;
    for (let i = 0; i < 2; i++) {
      while (pos < result.length && /[\s\n]/.test(result[pos])) pos++;
      if (result[pos] !== '{') { ok = false; break; }
      const b = extractBalancedBraces(result, pos);
      if (!b) { ok = false; break; }
      args.push(b.content);
      pos = b.endIndex;
    }
    if (ok && args.length === 2) {
      // Split title on $|$ to get project name and tech stack
      const rawTitle = args[0];
      const year = inlineLatexToHtml(args[1]);
      // Parse name (textbf part) and techs (emph part) from title
      const boldMatch = /\\textbf\{([^}]*)\}/.exec(rawTitle);
      const emphMatch = /\\emph\{([^}]*)\}/.exec(rawTitle);
      const linkMatch = /\\href\{([^}]*)\}\{([^}]*)\}/.exec(rawTitle);
      let projectName = boldMatch ? inlineLatexToHtml(boldMatch[1]) : inlineLatexToHtml(rawTitle.replace(/\$\|.*$/s, '').trim());
      const techStack = emphMatch ? `<span class="resume-proj-tech">${inlineLatexToHtml(emphMatch[1])}</span>` : '';
      const link = linkMatch ? ` <a href="${linkMatch[1]}" class="resume-proj-link" target="_blank" rel="noopener">&#8599;</a>` : '';
      const html = `\n<div class="resume-project-heading"><span class="resume-proj-left"><span class="resume-proj-name">${projectName}</span>${link}${techStack ? ' · ' + techStack : ''}</span><span class="resume-proj-year">${year}</span></div>\n`;
      replacements.push({ start: m.index, end: pos, html });
    }
  }
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.slice(0, r.start) + r.html + result.slice(r.end);
  }
  return result;
}

// ─── Main Level-3 LaTeX-to-Markdown+HTML transformer ─────────────────────────

/**
 * Main Level-3 LaTeX-to-Markdown transformer.
 * Produces Markdown with embedded HTML for resume-specific layout elements.
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

  // 3. Extract and Expand User Macros — BUT skip known Jake's resume commands
  //    so they don't get corrupted by generic macro expansion. The dedicated
  //    parsers below handle their calls with proper two-column HTML instead.
  const JAKES_COMMANDS = new Set([
    'resumeItem', 'resumeSubheading', 'resumeProjectHeading',
    'resumeSubItem', 'resumeItemListStart', 'resumeItemListEnd',
    'resumeSubheadingListStart', 'resumeSubheadingListEnd',
    'resumeSubHeadingListStart', 'resumeSubHeadingListEnd',
  ]);
  const { macros, strippedDoc } = extractLatexMacros(s);
  // Remove Jake's commands from the extracted macros so we handle them ourselves
  for (const name of JAKES_COMMANDS) macros.delete(name);
  s = expandUserMacros(strippedDoc, macros);

  // 3b. Discard Preamble if \begin{document} is present
  const docStartMatch = /\\begin\{document\}/.exec(s);
  if (docStartMatch) {
    const preamble = s.slice(0, docStartMatch.index);
    const afterDocStart = s.slice(docStartMatch.index + docStartMatch[0].length);
    const docEndMatch = /\\end\{document\}/.exec(afterDocStart);
    let body = docEndMatch ? afterDocStart.slice(0, docEndMatch.index) : afterDocStart;
    const titleM = /\\title\{([^}]*)\}/.exec(preamble);
    const authorM = /\\author\{([^}]*)\}/.exec(preamble);
    const dateM = /\\date\{([^}]*)\}/.exec(preamble);
    if (titleM) {
      const headerText = `# ${titleM[1]}\n${authorM ? `*${authorM[1]}*\n` : ''}${dateM ? `*${dateM[1]}*\n\n` : '\n'}`;
      if (/\\maketitle/.test(body)) { body = body.replace(/\\maketitle/g, headerText); }
      else { body = `${headerText}\n${body}`; }
    }
    s = body;
  }

  // 4. Protect Math Blocks
  const mathBlocks: string[] = [];
  const protectMath = (inner: string, isBlock: boolean) => {
    const idx = mathBlocks.length;
    const trimmed = inner.trim();
    if (isBlock) mathBlocks.push(`\n\n$$\n${trimmed}\n$$\n\n`);
    else mathBlocks.push(`$${trimmed}$`);
    return `%%MATHBLOCK_${idx}%%`;
  };
  s = s.replace(/\\begin\{(?:equation|displaymath)\*?\}([\s\S]*?)\\end\{(?:equation|displaymath)\*?\}/g, (_m, math) => protectMath(math, true));
  s = s.replace(/\\begin\{(?:align|aligned|gather|multline)\*?\}([\s\S]*?)\\end\{(?:align|aligned|gather|multline)\*?\}/g, (_m, math) => protectMath(`\\begin{aligned}${math}\\end{aligned}`, true));
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_m, math) => protectMath(math, true));
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_m, math) => protectMath(math, true));
  // Protect $|$ (pipe dividers in resumes) BEFORE inline math protection
  s = s.replace(/\$\s*\|\s*\$/g, '%%PIPEDIV%%');
  s = s.replace(/(?<!\\)\$(?!\$)([^$\n]+?)(?<!\\)\$/g, (_m, math) => protectMath(math, false));
  s = s.replace(/%%PIPEDIV%%/g, ' | ');

  // 4b. Jake's Resume Template — dedicated handlers BEFORE generic cleanup.
  // Template-detected: each block only transforms text when its commands are
  // actually present, and emits two-column HTML matching Overleaf's layout
  // (instead of flattening tabular* rows into "r Name **" garbage).
  // \resumeItemListStart / \resumeItemListEnd  →  open/close a <ul> via markers
  s = s.replace(/\\resumeItemListStart\b/g, '\n%%RESUME_LIST_START%%\n');
  s = s.replace(/\\resumeItemListEnd\b/g, '\n%%RESUME_LIST_END%%\n');
  s = s.replace(/\\resumeSub[Hh]eadingListStart\b/g, '\n%%RESUME_SUBH_START%%\n');
  s = s.replace(/\\resumeSub[Hh]eadingListEnd\b/g, '\n%%RESUME_SUBH_END%%\n');

  // Parse \resumeSubheading and \resumeProjectHeading BEFORE generic cleanup
  s = parseResumeSubheading(s);
  s = parseResumeProjectHeading(s);

  // \resumeItem{text} → proper bullet with resume-item class
  {
    let result = s;
    const re = /\\resumeItem\b/g;
    let m: RegExpExecArray | null;
    const replacements: Array<{ start: number; end: number; html: string }> = [];
    while ((m = re.exec(result)) !== null) {
      let pos = m.index + m[0].length;
      while (pos < result.length && /[\s\n]/.test(result[pos])) pos++;
      if (result[pos] !== '{') continue;
      const b = extractBalancedBraces(result, pos);
      if (b) {
        const content = inlineLatexToHtml(b.content);
        replacements.push({ start: m.index, end: b.endIndex, html: `\n- ${content}` });
      }
    }
    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i];
      result = result.slice(0, r.start) + r.html + result.slice(r.end);
    }
    s = result;
  }

  // \resumeSubItem{text} → same as resumeItem but indented
  {
    let result = s;
    const re = /\\resumeSubItem\b/g;
    let m: RegExpExecArray | null;
    const replacements: Array<{ start: number; end: number; html: string }> = [];
    while ((m = re.exec(result)) !== null) {
      let pos = m.index + m[0].length;
      while (pos < result.length && /[\s\n]/.test(result[pos])) pos++;
      if (result[pos] !== '{') continue;
      const b = extractBalancedBraces(result, pos);
      if (b) {
        const content = inlineLatexToHtml(b.content);
        replacements.push({ start: m.index, end: b.endIndex, html: `\n  - ${content}` });
      }
    }
    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i];
      result = result.slice(0, r.start) + r.html + result.slice(r.end);
    }
    s = result;
  }

  // 5. Section headings — emit h2 with resume-section class for small-caps + underline rule
  //    The .resume-section CSS (already defined) gives scshape + border-bottom matching Overleaf.
  s = s.replace(/\\section\*?\{([^}]*)\}/g, (_m, title) => {
    const clean = inlineLatexToHtml(title);
    return `\n<h2 class="resume-section">${clean}</h2>\n`;
  });

  // 6. Convert LaTeX Tables (including 2-column resume subheadings).
  // The preamble is consumed with balanced-brace parsing because column
  // specs nest (e.g. {l@{\extracolsep{\fill}}r}) — a naive [^}]* would stop
  // at the first inner brace and leak fragments like "}r}" as "r " text.
  s = convertTabularEnvs(s);

  // 11. TikZ fallback
  const tikzBlocks: string[] = [];
  s = s.replace(/\\begin\{tikzpicture\}([\s\S]*?)\\end\{tikzpicture\}/g, (_m, tikzCode) => {
    const idx = tikzBlocks.length;
    tikzBlocks.push(`\n\n> 📐 **TikZ Vector Graphic**\n\`\`\`latex\n\\begin{tikzpicture}${tikzCode}\\end{tikzpicture}\n\`\`\`\n\n`);
    return `%%TIKZBLOCK_${idx}%%`;
  });

  // 12. Structure & Document environments
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
    .replace(/\\subsection\*?\{([^}]*)\}/g, '### $1\n')
    .replace(/\\subsubsection\*?\{([^}]*)\}/g, '#### $1\n')
    .replace(/\\paragraph\*?\{([^}]*)\}/g, '**$1** — ');

  // 13. Preamble layout & styling commands
  s = stripLatexCommand(s, 'titlespacing', 4, false, true);
  s = stripLatexCommand(s, 'titleformat', 5, true, true);
  s = stripLatexCommand(s, 'hypersetup', 1);
  s = s
    .replace(/\\pagestyle\{[^}]*\}/g, '')
    .replace(/\\thispagestyle\{[^}]*\}/g, '')
    .replace(/\\pagenumbering\{[^}]*\}/g, '')
    // Jake's template preamble settings
    .replace(/\\setlength\{[^}]*\}\{[^}]*\}/g, '')
    .replace(/\\addtolength\{[^}]*\}\{[^}]*\}/g, '')
    .replace(/\\renewcommand\{[^}]*\}\{[^}]*\}/g, '')
    .replace(/\\urlstyle\{[^}]*\}/g, '')
    .replace(/\\raggedbottom\b/g, '')
    .replace(/\\raggedright\b/g, '')
    .replace(/\\fancyhf\{[^}]*\}/g, '')
    .replace(/\\fancyfoot\{[^}]*\}/g, '')
    // Generic LaTeX spacing & font sizing commands
    .replace(/\\(?:vspace|hspace)\*?\{[^}]*\}/g, '')
    .replace(/\\(?:Huge|huge|LARGE|Large|large|normalsize|small|footnotesize|tiny|scshape|normalfont|bfseries|itshape)\b/g, '')
    .replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, (_m, inner) => {
      // Detect resume name: {\Huge \textbf{Name}} or \textbf{\Huge Name}
      const nameMatch = /(?:\\textbf\s*\{(?:\\(?:Huge|LARGE|Large)\s+)?(?:\\scshape\s+)?([^\\{}][^{}]*)\}|\{\\Huge\s+\\textbf\{([^}]+)\}\})/.exec(inner);
      const name = nameMatch ? inlineLatexToHtml(nameMatch[1] || nameMatch[2]) : null;

      // Step 1: Mark ONLY true LaTeX \\ line-breaks with a sentinel.
      // Source-formatting newlines (indentation between \quad items) must be
      // collapsed — otherwise each \faPhone, \faEnvelope etc. ends up on its
      // own line instead of staying inline within their row.
      const marked = String(inner).replace(/\\\\(?:\[[^\]]*\])?/g, '%%CENTERBREAK%%');

      // Step 2: Collapse source whitespace/newlines WITHIN each marked segment
      const segments = marked.split('%%CENTERBREAK%%').map((seg) =>
        seg.replace(/\s+/g, ' ').trim(),
      ).filter((seg) => seg.length > 0);

      if (name && segments.length > 0) {
        // First segment contains the name — skip it; rest are contact rows
        const contactRows = segments.slice(1).map((seg) => inlineLatexToHtml(seg)).filter(Boolean);
        const contactHtml = contactRows.map((row) => `<p>${row}</p>`).join('\n');
        return `\n\n<div class="resume-center">\n<h1>${name}</h1>\n${contactHtml}\n</div>\n\n`;
      }
      const cleanLines = segments.map((seg) => inlineLatexToHtml(seg)).join('  \n');
      return `\n\n<div class="resume-center">\n\n${cleanLines}\n\n</div>\n\n`;
    });

  // 14. Academic environments
  s = s.replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g, (_m, abs) => {
    const lines = abs.trim().split('\n').map((l: string) => `> ${l.trim()}`).join('\n');
    return `\n\n> **Abstract**  \n${lines}\n\n`;
  });
  s = s.replace(/\\begin\{quote\}([\s\S]*?)\\end\{quote\}/g, (_m, q) => q.trim().split('\n').map((l: string) => `> ${l}`).join('\n'));
  s = s.replace(/\\begin\{theorem\}(?:\[([^\]]*)\])?([\s\S]*?)\\end\{theorem\}/g, (_m, opt, thm) => {
    const title = opt ? ` (${opt})` : '';
    return `\n\n> **Theorem${title}.** *${thm.trim()}*\n\n`;
  });
  s = s.replace(/\\begin\{proof\}([\s\S]*?)\\end\{proof\}/g, (_m, prf) => `\n\n*Proof.* ${prf.trim()} ∎\n\n`);

  // 15. Lists: itemize and enumerate
  s = s
    .replace(/\\begin\{itemize\}(?:\[[^\]]*\])?/g, '')
    .replace(/\\end\{itemize\}/g, '')
    .replace(/\\begin\{enumerate\}(?:\[[^\]]*\])?/g, '')
    .replace(/\\end\{enumerate\}/g, '')
    .replace(/\\item\s*/g, '- ');

  // 16. Spacing commands
  s = s.replace(/\\(?:vspace|hspace|smallskip|medskip|bigskip|noindent|indent)\*?(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, '');

  // 17. Typography, styles, links
  s = s
    .replace(/\\textbf\{([^}]*)\}/g, '**$1**')
    .replace(/\\textit\{([^}]*)\}/g, '*$1*')
    .replace(/\\emph\{([^}]*)\}/g, '*$1*')
    .replace(/\\texttt\{([^}]*)\}/g, '`$1`')
    .replace(/\\href\{([^}]*)\}\{\\underline\{([^}]*)\}\}/g, '[$2]($1)')
    .replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, '[$2]($1)')
    .replace(/\\underline\{([^}]*)\}/g, '$1')
    .replace(/\\textsc\{([^}]*)\}/g, '<span style="font-variant:small-caps">$1</span>')
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

  // 18. Figures and Graphics
  s = s.replace(/\\begin\{figure\}[\s\S]*?\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}[\s\S]*?(?:\\caption\{([^}]*)\})?[\s\S]*?\\end\{figure\}/g,
    (_m, path, caption) => `\n\n![${caption || 'Figure'}](${path})\n*${caption || ''}*\n\n`);

  // 19. Dashes (preserve Markdown table separators | --- |)
  s = s.replace(/(?<!\|)\s*---\s*(?!\|)/g, ' — ');

  // 20. Escape literal LaTeX symbols
  s = s
    .replace(/\\&/g, '&amp;')
    .replace(/\\%/g, '%')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\\$/g, '%%DOLLAR%%');

  // 20b. LaTeX control spaces and fontawesome icon commands.
  // A trailing control space (e.g. "\faPhone\ ") otherwise survives generic
  // cleanup as a stray backslash in the preview ("\ +91...", "\LinkedIn").
  // AI models also emit invalid starred forms (\faMapMarker*) — consume the
  // star too, or it survives as a literal "*" starting emphasis.
  s = s
    .replace(/\\\//g, '')
    .replace(/\\[ ,;:]/g, ' ')
    .replace(/\\fa[A-Z][A-Za-z]*\*?\s*/g, '');

  // 21. Generic cleanup of remaining unrecognized single macros
  s = s
    .replace(/\\[a-zA-Z]+(?:\*|\b)(?:\[[^\]]*\])?/g, '')
    .replace(/[{}]/g, '');

  // 22. Fix CommonMark bold delimiter space invalidation
  s = s
    .replace(/\*\*([ \t]+)([^*\n]+?)\*\*/g, '**$2**')
    .replace(/\*\*([^*\n]+?)([ \t]+)\*\*/g, '**$1**');

  // 23. Strip 2-8 space indentation from normal text
  s = s.replace(/^[ ]{2,8}(?!\*|-|\d+\.|#|>|`|\|)/gm, '');

  // 24. Restore list markers → proper HTML
  s = s.replace(/%%RESUME_LIST_START%%/g, '<ul class="resume-item-list">');
  s = s.replace(/%%RESUME_LIST_END%%/g, '</ul>');
  s = s.replace(/%%RESUME_SUBH_START%%/g, '<div class="resume-subh-list">');
  s = s.replace(/%%RESUME_SUBH_END%%/g, '</div>');

  // 25. Restore Code Blocks, TikZ, Dollar, Math
  s = s.replace(/%%CODEBLOCK_(\d+)%%/g, (_m, idx) => codeBlocks[Number(idx)] || '');
  s = s.replace(/%%TIKZBLOCK_(\d+)%%/g, (_m, idx) => tikzBlocks[Number(idx)] || '');
  s = s.replace(/%%DOLLAR%%/g, '$');
  s = s.replace(/%%TABLE_SEP%%/g, '---');
  // Collapse accidental quadruple-bold from double-wrapped formatting
  // (e.g. multicol ** + textbf ** → ****x****). Valid ***bold-italic*** and
  // lone *** rules are left untouched.
  s = s.replace(/\*{4,}([^*]+?)\*{4,}/g, '**$1**');
  s = s.replace(/^\*{4,}\s*$/gm, '***');
  s = s.replace(/%%MATHBLOCK_(\d+)%%/g, (_m, idx) => mathBlocks[Number(idx)] || '');

  return s.replace(/\n{3,}/g, '\n\n').trim();
}
