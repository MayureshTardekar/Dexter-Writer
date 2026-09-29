import { describe, it, expect } from 'vitest';
import { parseTexLog, findMissingPackage, isLatexEngineReady } from '../latexEngine';

const SAMPLE_LOG = `This is pdfTeX, Version 3.141592653-2.6-1.40.22 (TeX Live 2022)
entering extended mode
(./main.tex
LaTeX2e <2021-11-15> patch level 1
(/texlive/texmf-dist/tex/latex/base/article.cls)
Overfull \\hbox (12.34pt too wide) in paragraph at lines 45--47
Underfull \\vbox (badness 10000) has occurred while \\output is active
LaTeX Font Warning: Font shape \`OT1/cmr/m/n' undefined, using instead
LaTeX Warning: Citation \`foo2024' on page 1 undefined on input line 60.
Overfull \\hbox (12.34pt too wide) in paragraph at lines 45--47
[1] [2]
Output written on main.pdf (2 pages, 98734 bytes).
)`;

describe('parseTexLog', () => {
  it('extracts the page count', () => {
    expect(parseTexLog(SAMPLE_LOG).pages).toBe(2);
    expect(parseTexLog('no output line here').pages).toBeNull();
    expect(parseTexLog('').pages).toBeNull();
  });

  it('collects overfull/underfull/font/citation warnings, deduplicated', () => {
    const { warnings } = parseTexLog(SAMPLE_LOG);
    expect(warnings.some((w) => w.startsWith('Overfull'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('Underfull'))).toBe(true);
    expect(warnings.some((w) => w.includes('Font shape'))).toBe(true);
    expect(warnings.some((w) => w.includes('Citation'))).toBe(true);
    // duplicate Overfull line appears once
    expect(warnings.filter((w) => w.startsWith('Overfull')).length).toBe(1);
  });

  it('surfaces hard errors and missing files', () => {
    const log = "! LaTeX Error: File `missing.sty' not found.\nOutput written on x.pdf (1 page, 1 bytes).";
    const res = parseTexLog(log);
    expect(res.warnings.some((w) => w.includes('not found'))).toBe(true);
    expect(res.pages).toBe(1);
  });

  it('caps warnings at 8', () => {
    const log = Array.from({ length: 20 }, (_, i) => `Overfull \\hbox (${i}pt too wide) at line ${i}`).join('\n');
    expect(parseTexLog(log).warnings.length).toBe(8);
  });
});

describe('findMissingPackage — on-demand escalation trigger', () => {
  it('detects missing .sty/.cls files', () => {
    expect(findMissingPackage("! LaTeX Error: File `tikz.sty' not found.")).toBe('tikz.sty');
    expect(findMissingPackage("! LaTeX Error: File `IEEEtran.cls' not found.")).toBe('IEEEtran.cls');
  });

  it('returns null when nothing is missing', () => {
    expect(findMissingPackage('Output written on x.pdf (1 page, 1 bytes).')).toBeNull();
    expect(findMissingPackage('')).toBeNull();
    expect(findMissingPackage('Overfull \\hbox (3pt too wide)')).toBeNull();
  });
});

describe('isLatexEngineReady', () => {
  it('starts false before any initialization', () => {
    expect(isLatexEngineReady()).toBe(false);
  });
});

describe('Lambda Remote Compiler Configuration', () => {
  it('sets, gets, and clears custom lambda compiler URL', async () => {
    const memStorage = new Map<string, string>();
    // Ensure localStorage exists in test environment
    const originalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k: string) => memStorage.get(k) ?? null,
      setItem: (k: string, v: string) => memStorage.set(k, String(v)),
      removeItem: (k: string) => { memStorage.delete(k); },
      clear: () => { memStorage.clear(); },
      length: 0,
      key: () => null,
    };

    try {
      const { getLambdaUrl, setLambdaUrl, isRemoteCompilerConfigured } = await import('../latexEngine');
      expect(getLambdaUrl()).toBeNull();
      expect(isRemoteCompilerConfigured()).toBe(false);

      setLambdaUrl('https://my-lambda.amazonaws.com/');
      expect(getLambdaUrl()).toBe('https://my-lambda.amazonaws.com/');
      expect(isRemoteCompilerConfigured()).toBe(true);

      setLambdaUrl(null);
      expect(getLambdaUrl()).toBeNull();
      expect(isRemoteCompilerConfigured()).toBe(false);
    } finally {
      globalThis.localStorage = originalStorage;
    }
  });
});

