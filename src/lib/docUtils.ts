import type { DocMode } from './templates';
import { parseLatexLevel3 } from './latexParser';

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

/** Convert LaTeX source into readable, rich markdown-ish text for live preview (Level 3 Engine). */
export function latexToReadable(tex: string): string {
  return parseLatexLevel3(tex);
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
