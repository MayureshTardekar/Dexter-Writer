import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeBaseUrl,
  validateCustomProvider,
  saveCustomProvider,
  loadCustomProviders,
  deleteCustomProvider,
  clearCustomProviders,
  customKeyName,
  type CustomProvider,
} from '../customProviders';

function make(over: Partial<CustomProvider> = {}): CustomProvider {
  return {
    id: 'custom:test-1',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    createdAt: Date.now(),
    ...over,
  };
}

describe('customProviders', () => {
  beforeEach(() => clearCustomProviders());

  it('normalizes base URLs', () => {
    expect(normalizeBaseUrl('https://x.ai/v1///')).toBe('https://x.ai/v1');
    expect(normalizeBaseUrl('  http://localhost:11434/v1 ')).toBe('http://localhost:11434/v1');
    expect(normalizeBaseUrl('')).toBe('');
  });

  it('validates name, URL, and model', () => {
    expect(validateCustomProvider('', 'https://x.ai/v1', 'm')).toMatch(/name/i);
    expect(validateCustomProvider('T', '', 'm')).toMatch(/required/i);
    expect(validateCustomProvider('T', 'not-a-url', 'm')).toMatch(/valid URL/i);
    expect(validateCustomProvider('T', 'ftp://x.ai/v1', 'm')).toMatch(/http/i);
    expect(validateCustomProvider('T', 'http://evil.example.com/v1', 'm')).toMatch(/localhost/i);
    expect(validateCustomProvider('T', 'http://localhost:8000/v1', 'm')).toBeNull();
    expect(validateCustomProvider('T', 'https://api.together.xyz/v1', '')).toMatch(/model/i);
    expect(validateCustomProvider('T', 'https://api.together.xyz/v1', 'm')).toBeNull();
  });

  it('round-trips CRUD with normalized URLs', () => {
    saveCustomProvider(make({ baseUrl: 'https://x.ai/v1/' }));
    const all = loadCustomProviders();
    expect(all.length).toBe(1);
    expect(all[0].baseUrl).toBe('https://x.ai/v1');
    saveCustomProvider(make({ id: 'custom:test-2', name: 'GMI' }));
    expect(loadCustomProviders().length).toBe(2);
    deleteCustomProvider('custom:test-1');
    const rest = loadCustomProviders();
    expect(rest.length).toBe(1);
    expect(rest[0].id).toBe('custom:test-2');
  });

  it('scopes vault key names per endpoint', () => {
    expect(customKeyName('custom:abc')).toBe('custom-key:custom:abc');
    expect(customKeyName('custom:abc')).not.toBe(customKeyName('custom:xyz'));
  });
});
