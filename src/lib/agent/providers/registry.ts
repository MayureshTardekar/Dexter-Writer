import { loadCustomProviders, customKeyName } from '../../customProviders';

/**
 * Provider registry. Lives here (rather than in aiGateway.ts) so the agent
 * engine can resolve connection info without importing the legacy compat
 * layer, which would create an import cycle.
 *
 * `aiGateway.ts` re-exports everything in this file for backwards
 * compatibility — existing imports keep working unchanged.
 */

export type ProviderId = 'gemini' | 'nvidia' | 'groq' | 'openrouter' | 'openai' | 'anthropic' | 'ollama';

export interface ProviderInfo {
  id: string;
  label: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  needsKey: boolean;
  keyName: string;
  help: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'gemini', label: 'Google Gemini', defaultModel: '', needsKey: true, keyName: 'gemini', help: 'Google AI Studio key (AIza…).' },
  { id: 'nvidia', label: 'NVIDIA NIM (build.nvidia.com)', defaultModel: '', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', needsKey: true, keyName: 'nvidia', help: 'NVIDIA API key (nvapi-…). Choose an available model at build.nvidia.com' },
  { id: 'groq', label: 'Groq Cloud (Ultra Fast)', defaultModel: '', defaultBaseUrl: 'https://api.groq.com/openai/v1', needsKey: true, keyName: 'groq', help: 'Groq API key (gsk_…). Choose a model from your Groq account.' },
  { id: 'openrouter', label: 'OpenRouter', defaultModel: '', defaultBaseUrl: 'https://openrouter.ai/api/v1', needsKey: true, keyName: 'openrouter', help: 'OpenRouter key (sk-or-…). Choose a model available to your OpenRouter account.' },
  { id: 'openai', label: 'OpenAI', defaultModel: '', defaultBaseUrl: 'https://api.openai.com/v1', needsKey: true, keyName: 'openai', help: 'sk-… key. Direct browser call.' },
  { id: 'anthropic', label: 'Anthropic Claude', defaultModel: '', needsKey: true, keyName: 'anthropic', help: 'sk-ant-… key. Note: browsers may hit CORS; use Ollama if blocked.' },
  { id: 'ollama', label: 'Ollama (local)', defaultModel: '', defaultBaseUrl: 'http://localhost:11434/v1', needsKey: false, keyName: 'ollama-base', help: 'Local endpoint, e.g. http://localhost:11434/v1. Run with OLLAMA_ORIGINS=*' },
];

/**
 * Resolve any provider id (builtin or `custom:<…>`) to its connection info.
 * Unknown ids fall back to the default provider — never throw on bad state.
 */
export function resolveProvider(id: string): ProviderInfo {
  const builtin = PROVIDERS.find((p) => p.id === id);
  if (builtin) return builtin;
  if (id.startsWith('custom:')) {
    const def = loadCustomProviders().find((c) => c.id === id);
    if (def) {
      return {
        id: def.id,
        label: def.name,
        defaultModel: def.model,
        defaultBaseUrl: def.baseUrl,
        needsKey: !def.noKey,
        keyName: customKeyName(def.id),
        help: `Custom OpenAI-compatible endpoint at ${def.baseUrl}.`,
      };
    }
  }
  return PROVIDERS[0];
}

/**
 * Which wire protocol a provider speaks.
 *
 * Anything with a `defaultBaseUrl` is OpenAI-compatible (OpenAI, NVIDIA NIM,
 * Groq, OpenRouter, Ollama, and user-registered custom endpoints). Gemini and
 * Anthropic each have their own shape.
 */
export type ProviderKind = 'openai' | 'gemini' | 'anthropic';

export function providerKind(id: string): ProviderKind {
  const info = resolveProvider(id);
  if (info.defaultBaseUrl) return 'openai';
  if (info.id === 'anthropic') return 'anthropic';
  return 'gemini';
}

/** Effective model + base URL, applying provider defaults for blank fields. */
export function resolveConnection(
  provider: string,
  opts: { apiKey: string; baseUrl: string; model: string },
): { apiKey: string; baseUrl: string; model: string; kind: ProviderKind } {
  const info = resolveProvider(provider);
  if (!opts.model.trim() && !info.defaultModel) throw new Error('Choose an available model in AI Settings before sending a request.');
  return {
    // Ollama is keyless; sending a bearer token confuses some local servers.
    apiKey: provider === 'ollama' ? '' : opts.apiKey,
    baseUrl: opts.baseUrl.trim() || info.defaultBaseUrl || '',
    model: opts.model.trim() || info.defaultModel,
    kind: providerKind(provider),
  };
}
