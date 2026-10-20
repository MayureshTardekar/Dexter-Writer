import { streamProvider, type ProviderRequest } from './agent/providers';
import { resolveProvider } from './agent/providers/registry';

export interface ModelCapabilities { tools: boolean; vision?: boolean; checkedAt: number }
function key(provider: string, model: string, baseUrl: string) { return `dexter-write:capabilities:${provider}:${baseUrl}:${model}`; }
export function readModelCapabilities(provider: string, model: string, baseUrl: string): ModelCapabilities | null {
  try { return JSON.parse(localStorage.getItem(key(provider, model, baseUrl)) || 'null'); } catch { return null; }
}
export async function fetchAvailableModels(connection: Pick<ProviderRequest, 'provider' | 'apiKey' | 'baseUrl'>): Promise<string[]> {
  const provider = resolveProvider(connection.provider);
  let url: string;
  const headers: Record<string, string> = {};
  if (provider.id === 'gemini') { url = 'https://generativelanguage.googleapis.com/v1beta/models'; headers['x-goog-api-key'] = connection.apiKey; }
  else if (provider.id === 'anthropic') { url = 'https://api.anthropic.com/v1/models'; headers['x-api-key'] = connection.apiKey; headers['anthropic-version'] = '2023-06-01'; headers['anthropic-dangerous-direct-browser-access'] = 'true'; }
  else { url = (connection.baseUrl || provider.defaultBaseUrl || '').replace(/\/$/, '') + '/models'; if (provider.needsKey) headers.Authorization = `Bearer ${connection.apiKey}`; }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Model listing failed (${response.status}). You can enter a model ID manually.`);
  const body = await response.json();
  return (body.models || body.data || []).filter((m: { supportedGenerationMethods?: string[] }) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent')).map((m: { id?: string; name?: string }) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).sort();
}
/** Probe the selected model rather than guessing capabilities from its name. */
export async function testModelConnection(connection: Pick<ProviderRequest, 'provider' | 'apiKey' | 'model' | 'baseUrl'>, checkVision = false): Promise<ModelCapabilities> {
  if (!connection.model.trim()) throw new Error('Enter a model ID first.');
  const signal = AbortSignal.timeout(25000);
  let tools = false, replied = false;
  for await (const part of streamProvider({ ...connection, signal, maxTokens: 256, stream: false, messages: [{ role: 'user', content: 'Test this connection by calling connection_probe with ok=true. Do not use prose.' }], tools: [{ name: 'connection_probe', description: 'Confirm tool calling works. This has no side effects.', kind: 'read', parameters: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } }] })) {
    if (part.type === 'tool_call' && part.call.name === 'connection_probe' && part.call.args.ok === true) tools = true;
    if (part.type === 'text' && part.delta.trim()) replied = true;
  }
  if (!tools && !replied) throw new Error('The model returned no usable response.');
  const result: ModelCapabilities = { tools, checkedAt: Date.now() };
  if (checkVision) {
    let text = '';
    try {
      for await (const part of streamProvider({ ...connection, signal: AbortSignal.timeout(25000), maxTokens: 100, stream: false, tools: [], messages: [{ role: 'user', content: 'Is an image attached? Reply yes or no.', images: [{ name: 'test.png', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM8sAAAAASUVORK5CYII=' }] }] })) if (part.type === 'text') text += part.delta;
      result.vision = /^\s*yes\b/i.test(text);
    } catch { result.vision = false; }
  }
  localStorage.setItem(key(connection.provider, connection.model, connection.baseUrl), JSON.stringify(result));
  return result;
}
