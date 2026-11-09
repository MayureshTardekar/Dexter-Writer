import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from '../uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' });
    expect(createId()).toBe('123e4567-e89b-42d3-a456-426614174000');
  });

  it('builds a v4 id from getRandomValues outside secure contexts', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(7);
        return bytes;
      },
    });
    expect(createId()).toMatch(UUID_V4);
  });

  it('falls back when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    expect(createId()).toMatch(/^id-/);
  });
});
