import { describe, it, expect } from 'vitest';
import {
  extractBalancedBraces,
  extractLatexMacros,
  expandUserMacros,
  parseLatexTabular,
  parseLatexLevel3,
  stripLatexCommand,
} from '../latexParser';

describe('Level 3 LaTeX Parser — Balanced Braces & Macro Engine', () => {
  describe('extractBalancedBraces', () => {
    it('correctly extracts deeply nested curly braces without truncating', () => {
      const text = 'prefix {level1 {level2 {level3}} end1} suffix';
      const result = extractBalancedBraces(text, 7);
      expect(result).not.toBeNull();
      expect(result?.content).toBe('level1 {level2 {level3}} end1');
      expect(result?.endIndex).toBe(text.indexOf('suffix') - 1);
    });

    it('ignores escaped curly braces inside content', () => {
      const text = '{\\{literal brace\\}}';
      const result = extractBalancedBraces(text, 0);
      expect(result?.content).toBe('\\{literal brace\\}');
    });
  });

  describe('User Macro Expansion (\\newcommand & \\def)', () => {
    it('expands zero-argument macros across the document', () => {
      const tex = `
\\newcommand{\\model}{\\textbf{Dexter AI}}
\\def\\version{2.0}

Welcome to \\model version \\version!
`;
      const { macros, strippedDoc } = extractLatexMacros(tex);
      expect(macros.size).toBe(2);
      expect(macros.get('model')?.body).toBe('\\textbf{Dexter AI}');
      expect(macros.get('version')?.body).toBe('2.0');

      const expanded = expandUserMacros(strippedDoc, macros);
      expect(expanded).toContain('Welcome to \\textbf{Dexter AI} version 2.0!');
    });

    it('expands parameterized macros with #1, #2 arguments', () => {
      const tex = `
\\newcommand{\\norm}[1]{\\left\\|#1\\right\\|}
\\newcommand{\\metric}[2]{\\textbf{#1}: $#2\\%$}

Vector norm is $\\norm{v}$ and our \\metric{Accuracy}{98.5}.
`;
      const { macros, strippedDoc } = extractLatexMacros(tex);
      expect(macros.get('norm')?.paramCount).toBe(1);
      expect(macros.get('metric')?.paramCount).toBe(2);

      const expanded = expandUserMacros(strippedDoc, macros);
      expect(expanded).toContain('Vector norm is $\\left\\|v\\right\\|$');
      expect(expanded).toContain('our \\textbf{Accuracy}: $98.5\\%$');
    });
  });

  describe('Tabular with \\multicolumn', () => {
    it('normalizes multicolumn cells across table columns', () => {
      const tabular = `
Item & Quantity & Price \\\\
\\hline
\\multicolumn{2}{|c|}{Bundle Special} & \\$20.00 \\\\
Single & 1 & \\$5.00 \\\\
`;
      const markdownTable = parseLatexTabular(tabular);
      expect(markdownTable).toContain('| Item | Quantity | Price |');
      expect(markdownTable).toContain('| **Bundle Special** |  | $20.00 |');
      expect(markdownTable).toContain('| Single | 1 | $5.00 |');
    });
  });

  describe('Full parseLatexLevel3 Pipeline', () => {
    it('processes custom macros, KaTeX math, GFM tables, and TikZ cards', () => {
      const fullDoc = `
\\documentclass{article}
\\newcommand{\\R}{\\mathbb{R}}
\\newcommand{\\algo}{\\textbf{DexterNet}}

\\title{Next-Gen Document AI}
\\author{Research Team}

\\begin{document}
\\maketitle

\\begin{abstract}
We introduce \\algo, an end-to-end framework.
\\end{abstract}

\\section{Formulation}
Let $x \\in \\R^d$ be a feature vector.
\\begin{equation}
f(x) = \\sum_{i=1}^d w_i x_i + b
\\end{equation}

\\begin{tikzpicture}
\\node (A) {Input};
\\node (B) [right of=A] {Output};
\\draw[->] (A) -- (B);
\\end{tikzpicture}

\\end{document}
`;
      const result = parseLatexLevel3(fullDoc);
      // Title & Abstract
      expect(result).toContain('# Next-Gen Document AI');
      expect(result).toContain('> **Abstract**');
      expect(result).toContain('We introduce **DexterNet**, an end-to-end framework.');
      // Macro expanded inside inline math
      expect(result).toContain('$x \\in \\mathbb{R}^d$');
      // KaTeX block equation preserved
      expect(result).toContain('$$');
      expect(result).toContain('f(x) = \\sum_{i=1}^d w_i x_i + b');
      // TikZ vector graphic card
      expect(result).toContain('📐 **TikZ Vector Graphic**');
      expect(result).toContain('\\begin{tikzpicture}');
    });

    it('strips enumitem list options so they do not leak into the preview', () => {
      const tex = `
\\begin{itemize}[nosep,leftmargin=*]
\\item Built a RAG pipeline
\\item Shipped v2
\\end{itemize}
\\begin{enumerate}[label=\\arabic*.]
\\item First
\\end{enumerate}
`;
      const result = parseLatexLevel3(tex);
      expect(result).not.toContain('nosep');
      expect(result).not.toContain('leftmargin');
      expect(result).toContain('- Built a RAG pipeline');
      expect(result).toContain('- First');
    });

    it('drops spacing commands with their arguments instead of leaking lengths', () => {
      const tex = 'Hello\\vspace{4pt}\nWorld\\hspace{1em}!\n\\noindentIndented';
      const result = parseLatexLevel3(tex);
      expect(result).not.toContain('4pt');
      expect(result).not.toContain('1em');
      expect(result).toContain('Hello');
      expect(result).toContain('World');
      expect(result).toContain('Indented');
    });

    it('strips titlesec/titlespacing/hypersetup/pagestyle without leaking fragments', () => {
      const tex = `
\\titleformat{\\section}{\\large\\bfseries\\uppercase}{}{0em}{}[\\titlerule]
\\titlespacing{\\section}{0pt}{12pt}{4pt}
\\hypersetup{colorlinks=true,urlcolor=blue}
\\pagestyle{empty}
\\begin{center}
{\\Huge \\textbf{Mayuresh Tardekar}} \\\\[4pt]
Mumbai, India
\\end{center}
\\section{Education}
Body text.
`;
      const result = parseLatexLevel3(tex);
      expect(result).not.toContain('0em');
      expect(result).not.toContain('12pt');
      expect(result).not.toContain('colorlinks');
      expect(result).not.toContain('empty');
      expect(result).not.toContain('titlerule');
      expect(result).toContain('Mayuresh Tardekar');
      expect(result).toContain('Mumbai, India');
      expect(result).toContain('<h2 class="resume-section">Education</h2>');
      expect(result).toContain('Body text.');
    });

    it('stripLatexCommand consumes nested-brace args whole and spares malformed uses', () => {
      expect(stripLatexCommand('a\\titlespacing{\\section}{0pt}{12pt}{4pt}b', 'titlespacing', 4)).toBe('ab');
      expect(stripLatexCommand('a\\titleformat{\\s}{\\large\\bfseries\\uppercase}{}{0em}{}[\\titlerule]b', 'titleformat', 5, true, true)).toBe('ab');
      // unbalanced → left untouched
      expect(stripLatexCommand('a\\hypersetup{colorlinks=true', 'hypersetup', 1)).toContain('\\hypersetup');
    });

    it("parses Jake's resume without leaking preamble margins, lengths, or tabular* tags", () => {
      const jakeTex = `
\\documentclass[letterpaper,11pt]{article}
\\addtolength{\\oddsidemargin}{-0.5in}
\\addtolength{\\evensidemargin}{-0.5in}
\\addtolength{\\textwidth}{1in}
\\urlstyle{same}
\\setlength{\\tabcolsep}{0in}

\\newcommand{\\resumeSubheading}[4]{
  \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}
    \\textbf{#1} & #2 \\\\
    \\textit{\\small#3} & \\textit{\\small #4} \\\\
  \\end{tabular*}
}

\\begin{document}
\\begin{center}
    \\textbf{\\Huge \\scshape Mayuresh Tardekar} \\\\
    \\small Mumbai, India $|$ +91-8828334158 $|$ \\href{mailto:test@test.com}{\\underline{test@test.com}}
\\end{center}

\\section{Education}
\\resumeSubheading{Sardar Patel Institute of Technology}{Mumbai, India}{MCA}{2025 -- 2027}

\\end{document}
`;
      const result = parseLatexLevel3(jakeTex);
      expect(result).not.toContain('-0.5in');
      expect(result).not.toContain('same');
      expect(result).not.toContain('0in');
      expect(result).not.toContain('tabular*');
      expect(result).not.toContain('extracolsep');
      expect(result).not.toMatch(/^ *- r /m);
      expect(result).not.toMatch(/^- document$/m);
      expect(result).toContain('resume-subheading');
      expect(result).toContain('Mayuresh Tardekar');
      expect(result).toContain('Mumbai, India');
      expect(result).toContain('Sardar Patel Institute of Technology');
      expect(result).toContain('2025 – 2027');
      expect(result).toContain('<h2 class="resume-section">Education</h2>');
      expect(result).toContain('<a href="mailto:test@test.com">test@test.com</a>');
    });

    it('does not let macro expansion swallow unrelated groups (prefix + adjacency)', () => {
      // \resumeItem must not match inside \resumeItemListEnd and must not
      // grab a far-away {document} group as its argument.
      const tex = [
        '\\newcommand{\\resumeItem}[1]{\\item #1}',
        '\\newcommand{\\resumeItemListEnd}{\\end{itemize}}',
        '\\begin{document}',
        '\\resumeItemListStart',
        '\\resumeItem{Hi.}',
        '\\resumeItemListEnd',
        '\\end{document}',
      ].join('\n');
      const result = parseLatexLevel3(tex);
      expect(result).toContain('Hi.');
      expect(result).not.toMatch(/^- document$/m);
    });

    it('strips control spaces and fontawesome icons without leaving backslashes', () => {
      const tex = '\\begin{document}\n\\faPhone\\ +91-8828 $|$ \\faMapMarker\\ Mumbai \\/ India\n\\end{document}\n';
      const result = parseLatexLevel3(tex);
      expect(result).not.toMatch(/\\[a-zA-Z]/);
      expect(result).toContain('+91-8828');
      expect(result).toContain('Mumbai');
    });

    it('consumes invalid starred fontawesome forms without leaving asterisks', () => {
      const tex = '\\begin{document}\n\\faMapMarker*\\ Mumbai \\faExternalLink* Link\n\\end{document}\n';
      const result = parseLatexLevel3(tex);
      expect(result).not.toContain('\\faMapMarker');
      expect(result).not.toContain('\\faExternalLink');
      expect(result).toContain('Mumbai');
      expect(result).toContain('Link');
    });

    it('collapses accidental quadruple-bold markers but keeps valid emphasis', () => {
      const tex = '\\begin{document}\n****oops**** and ***fine***\n\\end{document}\n';
      const result = parseLatexLevel3(tex);
      expect(result).toContain('**oops**');
      expect(result).toContain('***fine***');
    });

    it('consumes nested-brace tabular* preambles instead of leaking the spec', () => {
      const tex = [
        '\\begin{document}',
        '\\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}',
        'Left & Right \\\\',
        '\\end{tabular*}',
        '\\end{document}',
      ].join('\n');
      const result = parseLatexLevel3(tex);
      expect(result).not.toContain('extracolsep');
      expect(result).not.toMatch(/(^|\n)r /);
      expect(result).toContain('Left');
      expect(result).toContain('Right');
    });
  });
});
