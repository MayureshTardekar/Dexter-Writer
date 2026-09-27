// User-defined OpenAI-compatible model endpoints (NVIDIA NIM custom picks,
// Together AI, GMI Cloud, Vultr, local vLLM, …). Anything speaking
// POST {base}/chat/completions works — same transport as Ollama/OpenRouter.

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  /** True for local servers that accept requests without an API key. */
  noKey?: boolean;
  createdAt: number;
}

const LS_KEY = 'dexter-write:custom-providers:v1';
const MAX_CUSTOM = 20;

const memFallback = new Map<string, string>();

function memStore(): Storage {
  return {
    getItem: (k: string) => (memFallback.has(k) ? memFallback.get(k)! : null),
    setItem: (k: string, v: string) => { memFallback.set(k, v); },
    removeItem: (k: string) => { memFallback.delete(k); },
    clear: () => memFallback.clear(),
    key: (i: number) => [...memFallback.keys()][i] ?? null,
    get length() { return memFallback.size; },
  };
}

function storage(): Storage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* fall through to memory */ }
  return memStore();
}

export function customProviderId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'endpoint';
  return `custom:${slug}-${Date.now().toString(36)}`;
}

export function customKeyName(id: string): string {
  return `custom-key:${id}`;
}

/** Normalize a base URL: trim, drop trailing slashes. Empty stays empty. */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/** Validate a custom endpoint. Returns an error message, or null when OK. */
export function validateCustomProvider(name: string, baseUrl: string, model: string): string | null {
  if (!name.trim()) return 'Give the endpoint a name (e.g. "Together AI").';
  const url = normalizeBaseUrl(baseUrl);
  if (!url) return 'Base URL is required (e.g. https://api.together.xyz/v1).';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Base URL is not a valid URL. Include the scheme, e.g. https://…';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Base URL must start with http:// or https://.';
  }
  if (parsed.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname)) {
    return 'Plain http:// is only allowed for localhost — use https:// for remote endpoints.';
  }
  if (!model.trim()) return 'Model name is required (copy the model id from the provider catalog).';
  return null;
}

export function loadCustomProviders(): CustomProvider[] {
  try {
    const raw = storage().getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as CustomProvider[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c) => c && typeof c.id === 'string' && typeof c.baseUrl === 'string')
      .slice(0, MAX_CUSTOM);
  } catch {
    return [];
  }
}

function persist(all: CustomProvider[]): void {
  try {
    storage().setItem(LS_KEY, JSON.stringify(all.slice(0, MAX_CUSTOM)));
  } catch { /* quota — ignore */ }
}

export function saveCustomProvider(c: CustomProvider): CustomProvider[] {
  const rest = loadCustomProviders().filter((x) => x.id !== c.id);
  const all = [{ ...c, baseUrl: normalizeBaseUrl(c.baseUrl) }, ...rest];
  persist(all);
  return all;
}

export function deleteCustomProvider(id: string): CustomProvider[] {
  const rest = loadCustomProviders().filter((x) => x.id !== id);
  persist(rest);
  return rest;
}

/** Test an endpoint the same way providers list models: GET {base}/models. */
export async function testCustomEndpoint(baseUrl: string, apiKey: string): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const base = normalizeBaseUrl(baseUrl);
  let res: Response;
  try {
    res = await fetch(`${base}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
  } catch (e) {
    return { ok: false, models: [], error: `Network error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, models: [], error: `HTTP ${res.status}: ${body.slice(0, 200) || res.statusText}` };
  }
  try {
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = Array.isArray(data.data) ? data.data.map((m) => String(m.id || '')).filter(Boolean).slice(0, 50) : [];
    return { ok: true, models };
  } catch {
    return { ok: false, models: [], error: 'Endpoint answered, but /models was not OpenAI-style JSON.' };
  }
}

/** Test helper: wipe stored customs. */
export function clearCustomProviders(): void {
  try {
    storage().removeItem(LS_KEY);
  } catch { /* ignore */ }
}
