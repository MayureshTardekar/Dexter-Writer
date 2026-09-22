import { vaultGet, vaultSet } from './vault';

// Phase 3: native GitHub sync — PAT or OAuth device-flow auth (BYOK style),
// GitHub REST for metadata, isomorphic-git + LightningFS for clone/commit/push.

const TOKEN_KEY = 'github-token';
const CLIENT_KEY = 'github-client-id';

export async function getGithubToken(): Promise<string> {
  return vaultGet(TOKEN_KEY);
}

export async function saveGithubToken(t: string): Promise<void> {
  await vaultSet(TOKEN_KEY, t);
}

export async function getGithubClientId(): Promise<string> {
  try {
    return localStorage.getItem(CLIENT_KEY) || '';
  } catch {
    return '';
  }
}

export function saveGithubClientId(id: string): void {
  try { localStorage.setItem(CLIENT_KEY, id); } catch { /* ignore */ }
}

export interface GithubUser {
  login: string;
  avatar_url?: string;
  name?: string;
}

async function gh(path: string, token: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function validateToken(token: string): Promise<GithubUser> {
  return (await gh('/user', token)) as GithubUser;
}

export interface GithubRepo {
  full_name: string;
  default_branch: string;
  private: boolean;
}

export async function listRepos(token: string): Promise<GithubRepo[]> {
  const out: GithubRepo[] = [];
  for (let page = 1; page <= 3; page++) {
    const chunk = (await gh(`/user/repos?per_page=100&page=${page}&sort=updated`, token)) as GithubRepo[];
    out.push(...chunk);
    if (chunk.length < 100) break;
  }
  return out;
}

export async function listRemoteBranches(owner: string, repo: string, token: string): Promise<string[]> {
  const bs = (await gh(`/repos/${owner}/${repo}/branches?per_page=100`, token)) as Array<{ name: string }>;
  return bs.map((b) => b.name);
}

// ---------- OAuth device flow (no client secret needed) ----------

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function startDeviceFlow(clientId: string, scope = 'repo'): Promise<DeviceCode> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope }),
  });
  if (!res.ok) throw new Error(`Device flow failed: HTTP ${res.status}. Check the OAuth App client ID.`);
  return (await res.json()) as DeviceCode;
}

export async function pollDeviceToken(clientId: string, deviceCode: string, intervalSec: number, signal: AbortSignal): Promise<string> {
  const wait = (ms: number) => new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });
  for (;;) {
    if (signal.aborted) throw new Error('aborted');
    await wait(Math.max(5, intervalSec) * 1000);
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    if (!res.ok) throw new Error(`Token poll failed: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
    if (data.access_token) return data.access_token;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { intervalSec += 5; continue; }
    throw new Error(data.error_description || data.error || 'Device flow failed.');
  }
}

// ---------- isomorphic-git (lazy) ----------

type GitFs = { promises: unknown } & Record<string, unknown>;

let fsPromise: Promise<GitFs> | null = null;

async function getFs(): Promise<GitFs> {
  if (!fsPromise) {
    fsPromise = (async () => {
      const mod = await import('@isomorphic-git/lightning-fs');
      const LightningFS = (mod as unknown as { default: new (name: string) => GitFs }).default ?? (mod as unknown as new (name: string) => GitFs);
      const Ctor = (typeof LightningFS === 'function' ? LightningFS : (mod as unknown as { LightningFS: new (name: string) => GitFs }).LightningFS) as new (name: string) => GitFs;
      return new Ctor('dexter-write-git');
    })();
  }
  return fsPromise;
}

async function getGit() {
  const [git, http] = await Promise.all([import('isomorphic-git'), import('isomorphic-git/http/web')]);
  return { git, http: (http as unknown as { default: unknown }).default };
}

const DOC_EXT = ['.md', '.tex', '.typ', '.txt'];

export interface RepoDoc {
  path: string;
  content: string;
}

async function wipeDir(fs: GitFs, dir: string): Promise<void> {
  const pfs = fs.promises as {
    readdir: (d: string) => Promise<string[]>;
    unlink: (f: string) => Promise<void>;
    rmdir: (d: string) => Promise<void>;
    stat: (f: string) => Promise<{ isDirectory: () => boolean }>;
  };
  try {
    const entries = await pfs.readdir(dir);
    for (const e of entries) {
      if (e === '.' || e === '..') continue;
      const full = `${dir}/${e}`;
      try {
        const st = await pfs.stat(full);
        if (st.isDirectory()) {
          await wipeDir(fs, full);
          await pfs.rmdir(full);
        } else {
          await pfs.unlink(full);
        }
      } catch { /* ignore */ }
    }
  } catch { /* dir may not exist */ }
}

async function walkDocs(fs: GitFs, dir: string, rel: string, out: RepoDoc[]): Promise<void> {
  const pfs = fs.promises as {
    readdir: (d: string) => Promise<string[]>;
    readFile: (f: string, enc: string) => Promise<string>;
    stat: (f: string) => Promise<{ isDirectory: () => boolean }>;
  };
  if (out.length > 200) return;
  let entries: string[] = [];
  try { entries = await pfs.readdir(dir); } catch { return; }
  for (const e of entries) {
    if (e === '.' || e === '..' || e === '.git') continue;
    const full = `${dir}/${e}`;
    const r = rel ? `${rel}/${e}` : e;
    try {
      const st = await pfs.stat(full);
      if (st.isDirectory()) {
        if (r.split('/').length <= 4) await walkDocs(fs, full, r, out);
      } else if (DOC_EXT.some((x) => e.toLowerCase().endsWith(x))) {
        const content = await pfs.readFile(full, 'utf8');
        if (content.length < 300_000) out.push({ path: r, content });
      }
    } catch { /* skip unreadable */ }
    if (out.length > 200) return;
  }
}

export interface CloneResult {
  docs: RepoDoc[];
  branch: string;
  dir: string;
}

export async function cloneDocs(opts: { owner: string; repo: string; branch?: string; token: string; onProgress?: (msg: string) => void }): Promise<CloneResult> {
  const [fs, { git, http }] = await Promise.all([getFs(), getGit()]);
  const dir = `/repos/${opts.owner}-${opts.repo}`.toLowerCase().replace(/[^a-z0-9/_-]/g, '-');
  opts.onProgress?.('Preparing workspace…');
  await wipeDir(fs, dir);
  const url = `https://github.com/${opts.owner}/${opts.repo}`;
  opts.onProgress?.(`Cloning ${opts.owner}/${opts.repo}…`);
  await (git.clone as (...a: never[]) => Promise<void>)({
    fs, http, dir, url, ref: opts.branch, singleBranch: true, depth: 1,
    onAuth: () => ({ username: opts.token }),
    onProgress: (e: { phase?: string; loaded?: number; total?: number }) => {
      if (e?.phase) opts.onProgress?.(`${e.phase} ${e.loaded ?? ''}/${e.total ?? ''}`);
    },
  } as never);
  const branch = opts.branch || (((await (git.currentBranch as (...a: never[]) => Promise<string | undefined>)({ fs, dir } as never)) as string) || 'main');
  const docs: RepoDoc[] = [];
  await walkDocs(fs, dir, '', docs);
  return { docs, branch, dir };
}

export async function pushDocs(opts: {
  dir: string; branch: string; token: string; message: string;
  author: { name: string; email: string };
  docs: RepoDoc[];
  onProgress?: (msg: string) => void;
}): Promise<string> {
  const [fs, { git, http }] = await Promise.all([getFs(), getGit()]);
  const pfs = (fs as GitFs).promises as {
    writeFile: (f: string, c: string) => Promise<void>;
    mkdir: (d: string) => Promise<void>;
    unlink: (f: string) => Promise<void>;
  };
  // Write project docs
  for (const d of opts.docs) {
    const parts = d.path.split('/');
    let acc = opts.dir;
    for (let i = 0; i < parts.length - 1; i++) {
      acc += `/${parts[i]}`;
      try { await pfs.mkdir(acc); } catch { /* exists */ }
    }
    await pfs.writeFile(`${opts.dir}/${d.path}`, d.content);
  }
  // Stage: add new/modified, remove tracked files no longer present
  const matrix = (await (git.statusMatrix as (...a: never[]) => Promise<Array<[string, number, number, number]>>)({ fs, dir: opts.dir } as never)) as Array<[string, number, number, number]>;
  const keep = new Set(opts.docs.map((d) => d.path));
  for (const [filepath, , workdirStatus] of matrix) {
    if (workdirStatus === 0 && !keep.has(filepath)) {
      await (git.remove as (...a: never[]) => Promise<void>)({ fs, dir: opts.dir, filepath } as never);
    } else if (!filepath.startsWith('.git')) {
      await (git.add as (...a: never[]) => Promise<void>)({ fs, dir: opts.dir, filepath } as never);
    }
  }
  opts.onProgress?.('Committing…');
  const sha = (await (git.commit as (...a: never[]) => Promise<string>)({
    fs, dir: opts.dir, message: opts.message || 'Update from Dexter Write', author: opts.author,
  } as never)) as string;
  opts.onProgress?.('Pushing…');
  await (git.push as (...a: never[]) => Promise<unknown>)({
    fs, http, dir: opts.dir, ref: opts.branch,
    onAuth: () => ({ username: opts.token }),
  } as never);
  return sha;
}

export async function ensureBranch(opts: { dir: string; branch: string }): Promise<void> {
  const [fs, { git }] = await Promise.all([getFs(), getGit()]);
  const current = (await (git.currentBranch as (...a: never[]) => Promise<string | undefined>)({ fs, dir: opts.dir } as never)) as string | undefined;
  if (current === opts.branch) return;
  const branches = (await (git.listBranches as (...a: never[]) => Promise<string[]>)({ fs, dir: opts.dir } as never)) as string[];
  if (!branches.includes(opts.branch)) {
    await (git.branch as (...a: never[]) => Promise<void>)({ fs, dir: opts.dir, ref: opts.branch, checkout: true } as never);
  } else {
    await (git.checkout as (...a: never[]) => Promise<void>)({ fs, dir: opts.dir, ref: opts.branch } as never);
  }
}
