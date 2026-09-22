// BYOK Security Vault — AES-GCM encrypted localStorage.
// Keys never leave the browser except direct HTTPS calls to the provider.

const LS_KEY_PREFIX = 'dexter-write:vault:';
const DEVICE_KEY_LS = 'dexter-write:device-key-jwk';

async function getDeviceKey(): Promise<CryptoKey> {
  const stored = localStorage.getItem(DEVICE_KEY_LS);
  if (stored) {
    try {
      const jwk = JSON.parse(stored);
      return await crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    } catch {
      // fall through to regenerate
    }
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const jwk = await crypto.subtle.exportKey('jwk', key);
  localStorage.setItem(DEVICE_KEY_LS, JSON.stringify(jwk));
  return key;
}

function b64encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function vaultSet(name: string, plaintext: string): Promise<void> {
  if (!plaintext) {
    localStorage.removeItem(LS_KEY_PREFIX + name);
    return;
  }
  const key = await getDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  localStorage.setItem(LS_KEY_PREFIX + name, JSON.stringify({ iv: b64encode(iv.buffer as ArrayBuffer), ct: b64encode(ct) }));
}

export async function vaultGet(name: string): Promise<string> {
  const raw = localStorage.getItem(LS_KEY_PREFIX + name);
  if (!raw) return '';
  try {
    const { iv, ct } = JSON.parse(raw);
    const key = await getDeviceKey();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(iv) as BufferSource }, key, b64decode(ct).buffer as ArrayBuffer);
    return new TextDecoder().decode(pt);
  } catch {
    return '';
  }
}

export function vaultHas(name: string): boolean {
  return !!localStorage.getItem(LS_KEY_PREFIX + name);
}

export function vaultDelete(name: string): void {
  localStorage.removeItem(LS_KEY_PREFIX + name);
}
