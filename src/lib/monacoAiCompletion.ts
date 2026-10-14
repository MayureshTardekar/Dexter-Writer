import {
  canCallNow,
  completeInline,
  getCachedCompletion,
  MAX_PREFIX_CHARS,
  MAX_SUFFIX_CHARS,
  noteCallFailed,
  noteCallStarted,
  noteCallSucceeded,
  setCachedCompletion,
} from './agent/completion';
import { isAbortError } from './agent/types';

/**
 * Monaco inline-completions (ghost text) provider.
 *
 * Registered ONCE at module scope, like registerLatexLanguage, because
 * `App.tsx` keys the editor by file id — Monaco remounts on every file switch,
 * and a provider registered per-mount would stack duplicates (duplicated ghost
 * text). Live settings are read from module state that EditorPane refreshes.
 *
 * Non-intrusiveness rules (AI_AGENT_ROADMAP.md §10) enforced here:
 *  - disabled by default; zero network traffic while `enabled` is false
 *  - only suggests at end-of-line, never in the middle of existing text
 *  - 500ms debounce, one in-flight request, aborted when the user types
 *  - prefix cache + minimum call interval + rate-limit circuit breaker
 */

const DEBOUNCE_MS = 500;
const LANGUAGES = ['latex', 'typst', 'markdown'];

export interface AiCompletionConfig {
  enabled: boolean;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  mode: string;
  fileName?: string;
  /** Called when the breaker trips so the UI can switch the feature off. */
  onRateLimited?: (message: string) => void;
}

interface CancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested?: (listener: () => void) => void;
}

interface PositionLike {
  lineNumber: number;
  column: number;
}

interface ModelLike {
  getValue(): string;
  getOffsetAt(position: PositionLike): number;
}

interface MonacoLike {
  Range: new (startLine: number, startCol: number, endLine: number, endCol: number) => unknown;
  languages: {
    registerInlineCompletionsProvider(language: string, provider: unknown): { dispose(): void };
  };
}

let registered = false;
let config: AiCompletionConfig | null = null;
let inflight: AbortController | null = null;

export function setAiCompletionConfig(next: AiCompletionConfig | null): void {
  config = next;
}

export function isAiCompletionActive(): boolean {
  return Boolean(config?.enabled);
}

/** Abort any in-flight suggestion (e.g. when the feature is switched off). */
export function cancelInflightCompletion(): void {
  inflight?.abort();
  inflight = null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Conservative trigger rule: only complete at the end of a line, so ghost text
 * never appears in the middle of text the user is editing.
 */
export function shouldSuggest(prefix: string, suffix: string): boolean {
  if (prefix.trim().length < 2) return false;
  const restOfLine = suffix.split('\n', 1)[0];
  if (restOfLine.trim().length > 0) return false;
  return true;
}

export function registerAiInlineCompletion(monaco: MonacoLike): void {
  if (registered) return;
  registered = true;

  const provider = {
    async provideInlineCompletions(
      model: ModelLike,
      position: PositionLike,
      _context: unknown,
      token: CancellationToken,
    ): Promise<{ items: Array<{ insertText: string; range: unknown }> }> {
      const empty = { items: [] };
      const cfg = config;
      if (!cfg || !cfg.enabled) return empty;
      if (token.isCancellationRequested) return empty;

      const makeItem = (text: string) => ({
        items: [{
          insertText: text,
          range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
        }],
      });

      let full: string;
      let offset: number;
      try {
        full = model.getValue();
        offset = model.getOffsetAt(position);
      } catch {
        return empty;
      }

      const prefix = full.slice(Math.max(0, offset - MAX_PREFIX_CHARS), offset);
      const suffix = full.slice(offset, offset + MAX_SUFFIX_CHARS);
      if (!shouldSuggest(prefix, suffix)) return empty;

      // Cached (including a cached "nothing useful here") — free, instant.
      const cached = getCachedCompletion(prefix);
      if (cached !== undefined) return cached ? makeItem(cached) : empty;

      await sleep(DEBOUNCE_MS);
      if (token.isCancellationRequested) return empty;
      if (!config?.enabled) return empty;
      if (!canCallNow()) return empty;

      inflight?.abort();
      const ac = new AbortController();
      inflight = ac;
      token.onCancellationRequested?.(() => ac.abort());
      noteCallStarted();

      try {
        const text = await completeInline({
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          mode: cfg.mode,
          fileName: cfg.fileName,
          prefix,
          suffix,
          signal: ac.signal,
        });
        noteCallSucceeded();
        // Cache empty results too, so dead spots don't re-bill.
        setCachedCompletion(prefix, text);
        if (token.isCancellationRequested || !text) return empty;
        return makeItem(text);
      } catch (e) {
        if (isAbortError(e)) return empty;
        const message = e instanceof Error ? e.message : String(e);
        if (noteCallFailed(message)) cfg.onRateLimited?.(message);
        return empty;
      } finally {
        if (inflight === ac) inflight = null;
      }
    },
    freeInlineCompletions(): void {
      /* nothing to release — items are plain objects */
    },
  };

  for (const language of LANGUAGES) {
    try {
      monaco.languages.registerInlineCompletionsProvider(language, provider);
    } catch { /* a missing language is not fatal */ }
  }
}
