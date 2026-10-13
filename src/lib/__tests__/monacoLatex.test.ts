import { describe, it, expect, beforeEach, vi } from 'vitest';

// Fresh module state per test (the `registered` flag is module-scoped).
beforeEach(() => {
  vi.resetModules();
});

type TokenRule = readonly [RegExp, string] | readonly [RegExp, string, string];

interface ProviderDef {
  tokenizer: Record<string, TokenRule[]>;
}

function makeMonaco(failOn?: 'register' | 'provider' | 'config') {
  const calls = {
    register: [] as Array<{ id: string }>,
    provider: [] as Array<{ id: string; def: ProviderDef }>,
    config: [] as Array<{ id: string; config: { comments: { lineComment: string }; autoClosingPairs: unknown[] } }>,
  };
  const monaco = {
    languages: {
      register(lang: { id: string }) {
        if (failOn === 'register') throw new Error('nope');
        calls.register.push(lang);
      },
      setMonarchTokensProvider(id: string, def: ProviderDef) {
        if (failOn === 'provider') throw new Error('nope');
        calls.provider.push({ id, def });
      },
      setLanguageConfiguration(id: string, config: { comments: { lineComment: string }; autoClosingPairs: unknown[] }) {
        if (failOn === 'config') throw new Error('nope');
        calls.config.push({ id, config });
      },
    },
  };
  return { monaco, calls };
}

describe('registerLatexLanguage', () => {
  it('registers id "latex" with a tokenizer covering commands, math, comments and delimiters', async () => {
    const { registerLatexLanguage: register } = await import('../monacoLatex');
    const { monaco, calls } = makeMonaco();
    register(monaco);
    expect(calls.register).toEqual([{ id: 'latex' }]);
    expect(calls.provider).toHaveLength(1);
    expect(calls.provider[0].id).toBe('latex');
    const root = calls.provider[0].def.tokenizer.root;
    const tokens = new Set(root.map((r) => r[1]));
    for (const t of ['comment', 'string', 'keyword', 'keyword.control', 'number', 'delimiter.curly', 'delimiter.bracket', 'keyword.operator', 'string.escape']) {
      expect(tokens.has(t)).toBe(true);
    }
  });

  it('configures % line comments and auto-closing pairs (Ctrl+/)', async () => {
    const { registerLatexLanguage: register } = await import('../monacoLatex');
    const { monaco, calls } = makeMonaco();
    register(monaco);
    expect(calls.config).toHaveLength(1);
    expect(calls.config[0].id).toBe('latex');
    expect(calls.config[0].config.comments.lineComment).toBe('%');
    expect(calls.config[0].config.autoClosingPairs.length).toBeGreaterThan(0);
  });

  it('is idempotent — second call is a no-op', async () => {
    const { registerLatexLanguage: register } = await import('../monacoLatex');
    const { monaco, calls } = makeMonaco();
    register(monaco);
    register(monaco);
    expect(calls.register).toHaveLength(1);
    expect(calls.provider).toHaveLength(1);
  });

  it('resets on failure so a later retry can succeed', async () => {
    const mod = await import('../monacoLatex');
    const bad = makeMonaco('register');
    expect(() => mod.registerLatexLanguage(bad.monaco)).not.toThrow();
    expect(bad.calls.register).toHaveLength(0);
    const good = makeMonaco();
    mod.registerLatexLanguage(good.monaco);
    expect(good.calls.register).toEqual([{ id: 'latex' }]);
  });
});
