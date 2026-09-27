import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, detectDocMacros } from '../aiGateway';

describe('buildSystemPrompt — agentic discipline', () => {
  it('tells the model to read before writing and stay surgical', () => {
    const p = buildSystemPrompt('markdown', '- Intro (line 1)', '# Hello\nworld');
    expect(p).toMatch(/read_document_content/i);
    expect(p).toMatch(/surgical|smallest range/i);
    expect(p).toMatch(/never duplicate/i);
  });

  it('answers questions instead of tool-spamming', () => {
    const p = buildSystemPrompt('latex', '', '');
    expect(p).toMatch(/question/i);
  });

  it('includes LaTeX hygiene rules for latex docs', () => {
    const p = buildSystemPrompt('latex', '', '');
    expect(p).toMatch(/nosep/);
    expect(p).toMatch(/balanced|braces/i);
  });

  it('includes Typst hygiene rules for typst docs', () => {
    const p = buildSystemPrompt('typst', '', '');
    expect(p).toMatch(/never invent/i);
  });

  it('mentions the target file name when provided', () => {
    const p = buildSystemPrompt('markdown', '', 'hi', '', 'resume.md');
    expect(p).toContain('resume.md');
  });

  it('passes extra context through when provided', () => {
    const p = buildSystemPrompt('markdown', '', 'hi', '', '', '- Custom note here');
    expect(p).toContain('Custom note here');
  });
});

describe('detectDocMacros — template-aware prompting', () => {
  it('finds user-defined macros in latex docs', () => {
    const tex = '\\newcommand{\\resumeItem}[1]{\\item #1}\n\\def\\tightlist{}\n\\section{Hi}\nBody';
    const found = detectDocMacros(tex, 'latex');
    expect(found).toContain('resumeItem');
    expect(found).toContain('tightlist');
  });

  it('returns nothing for markdown or macro-free docs', () => {
    expect(detectDocMacros('# Hello', 'markdown')).toEqual([]);
    expect(detectDocMacros('\\section{Hi}\nBody', 'latex')).toEqual([]);
    expect(detectDocMacros('', 'latex')).toEqual([]);
  });
});

describe('PROVIDERS registry', () => {
  it('includes NVIDIA NIM with integrate endpoint and muse-glimmer default', async () => {
    const { PROVIDERS } = await import('../aiGateway');
    const nvidia = PROVIDERS.find((p) => p.id === 'nvidia');
    expect(nvidia).toBeDefined();
    expect(nvidia?.defaultBaseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(nvidia?.defaultModel).toBe('meta/muse-glimmer-30b');
    expect(nvidia?.needsKey).toBe(true);
  });

  it('includes Groq and OpenRouter presets', async () => {
    const { PROVIDERS } = await import('../aiGateway');
    const groq = PROVIDERS.find((p) => p.id === 'groq');
    expect(groq?.defaultBaseUrl).toBe('https://api.groq.com/openai/v1');
    const openrouter = PROVIDERS.find((p) => p.id === 'openrouter');
    expect(openrouter?.defaultBaseUrl).toBe('https://openrouter.ai/api/v1');
  });
});
