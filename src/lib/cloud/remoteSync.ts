import type { CloudFileMeta } from './cloudStore';

export interface CloudSyncBaselineEntry {
  version: number;
  hash: string;
}

export type CloudSyncBaseline = Record<string, CloudSyncBaselineEntry>;

const KEY_PREFIX = 'dexter-write:cloud-baseline:';

export function contentHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function makeBaseline(
  metas: CloudFileMeta[],
  files: Array<{ name: string; content: string }>,
): CloudSyncBaseline {
  const contentByName = new Map(files.map((file) => [file.name, file.content]));
  const baseline: CloudSyncBaseline = {};
  for (const meta of metas) {
    const content = contentByName.get(meta.path);
    if (content === undefined) continue;
    baseline[meta.path] = { version: meta.version, hash: contentHash(content) };
  }
  return baseline;
}

export function changedFiles(metas: CloudFileMeta[], baseline: CloudSyncBaseline): CloudFileMeta[] {
  return metas.filter((meta) => {
    const known = baseline[meta.path];
    return !known || known.version !== meta.version;
  });
}

export function matchesBaseline(content: string, baseline: CloudSyncBaselineEntry | undefined): boolean {
  return Boolean(baseline && baseline.hash === contentHash(content));
}

export function loadCloudBaseline(projectId: string): CloudSyncBaseline {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${projectId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const baseline: CloudSyncBaseline = {};
    for (const [path, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.version !== 'number' || typeof candidate.hash !== 'string') continue;
      baseline[path] = { version: candidate.version, hash: candidate.hash };
    }
    return baseline;
  } catch {
    return {};
  }
}

export function saveCloudBaseline(projectId: string, baseline: CloudSyncBaseline): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${projectId}`, JSON.stringify(baseline));
  } catch {
    /* storage disabled or full */
  }
}

export function clearCloudBaseline(projectId: string): void {
  try {
    localStorage.removeItem(`${KEY_PREFIX}${projectId}`);
  } catch {
    /* ignore */
  }
}
