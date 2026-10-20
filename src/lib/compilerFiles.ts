import type { CompileFile } from './projectRuntime';
import { projectPath } from './projectPaths';

export function compilerCacheKey(source: string, files: CompileFile[] = [], main = ''): string {
  // Include names and every byte. Equal-sized asset replacements must invalidate the cache.
  let hash = 2166136261;
  const update = (bytes: Uint8Array) => { for (const b of bytes) hash = Math.imul(hash ^ b, 16777619) >>> 0; };
  const encoder = new TextEncoder();
  update(encoder.encode(main)); update(encoder.encode(source));
  for (const file of files) { update(encoder.encode(projectPath(file.path))); update(typeof file.content === 'string' ? encoder.encode(file.content) : file.content); }
  return `${source.length}:${hash}`;
}
export function bytesBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
