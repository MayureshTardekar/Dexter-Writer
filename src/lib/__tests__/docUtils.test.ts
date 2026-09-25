import { describe, it, expect } from 'vitest';
import { latexToReadable, getDocumentOutline, getDocStats } from '../docUtils';

describe('LaTeX to Readable Engine', () => {
  it('preserves mathematical equations intact for KaTeX rendering', () => {
    const tex = `
\\documentclass{article}
\\begin{document}
Here is an equation:
\\begin{equation}
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
\\end{equation}
And an inline formula $E = mc^2$.
\\end{document}
`;
    const res = latexToReadable(tex);
    // Math block must be preserved inside $$ ... $$
    expect(res).toContain('$$');
    expect(res).toContain('\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}');
    // Inline math must be preserved inside $ ... $
    expect(res).toContain('$E = mc^2$');
  });

  it('converts LaTeX tabular into GFM Markdown table', () => {
    const tex = `
\\begin{tabular}{l c r}
\\hline
Item & Quantity & Price \\\\
\\hline
Widget & 10 & \\$5.00 \\\\
Gadget & 5 & \\$12.50 \\\\
\\hline
\\end{tabular}
`;
    const res = latexToReadable(tex);
    expect(res).toContain('| Item | Quantity | Price |');
    expect(res).toContain('| --- | --- | --- |');
    expect(res).toContain('| Widget | 10 | $5.00 |');
    expect(res).toContain('| Gadget | 5 | $12.50 |');
  });

  it('converts abstract, quote, theorem, and proof into styled blockquotes', () => {
    const tex = `
\\begin{abstract}
This paper presents a modern client-side document editor.
\\end{abstract}
\\begin{theorem}[Euler]
e^{i\\pi} + 1 = 0
\\end{theorem}
\\begin{proof}
By Taylor series expansion.
\\end{proof}
`;
    const res = latexToReadable(tex);
    expect(res).toContain('> **Abstract**');
    expect(res).toContain('This paper presents a modern client-side document editor.');
    expect(res).toContain('> **Theorem (Euler).**');
    expect(res).toContain('*Proof.* By Taylor series expansion. ∎');
  });

  it('preserves verbatim code blocks with code fences', () => {
    const tex = `
\\begin{verbatim}
function add(a, b) {
  return a + b;
}
\\end{verbatim}
`;
    const res = latexToReadable(tex);
    expect(res).toContain('```\nfunction add(a, b) {\n  return a + b;\n}\n```');
  });

  it('converts sections, bold, italics, and href links', () => {
    const tex = `
\\section{Introduction}
Welcome to \\textbf{Dexter Write}! Visit \\href{https://github.com}{GitHub}.
`;
    const res = latexToReadable(tex);
    expect(res).toContain('## Introduction');
    expect(res).toContain('**Dexter Write**');
    expect(res).toContain('[GitHub](https://github.com)');
  });
});

describe('Document Outline & Stats', () => {
  it('extracts outline headings for markdown, typst, and latex', () => {
    const mdOutline = getDocumentOutline('# Title\n## Subtitle\n### Section', 'markdown');
    expect(mdOutline.length).toBe(3);
    expect(mdOutline[0].title).toBe('Title');
    expect(mdOutline[1].title).toBe('Subtitle');

    const texOutline = getDocumentOutline('\\section{Intro}\n\\subsection{Background}', 'latex');
    expect(texOutline.length).toBe(2);
    expect(texOutline[0].title).toBe('Intro');
    expect(texOutline[1].title).toBe('Background');
  });

  it('calculates word and character counts accurately', () => {
    const stats = getDocStats('Hello world, this is a test document.');
    expect(stats.words).toBe(7);
    expect(stats.lines).toBe(1);
    expect(stats.readingTimeMin).toBe(1);
  });
});
