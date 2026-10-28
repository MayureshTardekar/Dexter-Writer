import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const cloudConfigured = url.length > 0 && anonKey.length > 0;

export const supabase: SupabaseClient | null = cloudConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;

export const cloudCompileEnabled = String(import.meta.env.VITE_COMPILE_CLOUD ?? 'on') !== 'off';

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Cloud is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild.');
  }
  return supabase;
}

export function cloudFunctionUrl(name: string): string | null {
  if (!url) return null;
  return `${url.replace(/\/$/, '')}/functions/v1/${name}`;
}

export function mcpEndpoint(): string | null {
  return cloudFunctionUrl('mcp');
}

export function healthEndpoint(): string | null {
  return cloudFunctionUrl('health');
}
