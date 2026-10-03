import { describe, it, expect } from 'vitest';
import { extractLatexCode } from '../latexFixer';

describe('extractLatexCode', () => {
  it('extracts LaTeX code inside fenced latex code blocks', () => {
    const response = 'Here is the fixed document:\n```latex\n\\documentclass{article}\n\\begin{document}\nFixed\n\\end{document}\n```\nHope this helps!';
    expect(extractLatexCode(response)).toBe('\\documentclass{article}\n\\begin{document}\nFixed\n\\end{document}');
  });

  it('extracts LaTeX code inside fenced tex code blocks', () => {
    const response = '```tex\n\\documentclass{article}\n\\begin{document}\nFixed Tex\n\\end{document}\n```';
    expect(extractLatexCode(response)).toBe('\\documentclass{article}\n\\begin{document}\nFixed Tex\n\\end{document}');
  });

  it('extracts bare documentclass text when no code fences are used', () => {
    const response = '\\documentclass{article}\n\\begin{document}\nBare content\n\\end{document}';
    expect(extractLatexCode(response)).toBe(response);
  });

  it('returns null when no LaTeX document or code fence is present', () => {
    expect(extractLatexCode('I cannot fix this document.')).toBeNull();
  });
});
