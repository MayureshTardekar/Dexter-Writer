import { useEffect, useRef, useState } from 'react';
import {
  cloneDocs,
  ensureBranch,
  getGithubClientId,
  getGithubToken,
  listRemoteBranches,
  listRepos,
  pollDeviceToken,
  pushDocs,
  saveGithubClientId,
  saveGithubToken,
  startDeviceFlow,
  validateToken,
  type DeviceCode,
  type GithubRepo,
  type GithubUser,
  type RepoDoc,
} from '../lib/github';
import { getSelfName } from '../lib/collab';
import ModalHeader from './ModalHeader';
import type { ProjectFile } from '../lib/projectFiles';

interface Props {
  files: ProjectFile[];
  onImportFiles: (docs: RepoDoc[]) => void;
  onClose: () => void;
}

export default function GithubPanel({ files, onImportFiles, onClose }: Props) {
  const [tab, setTab] = useState<'connect' | 'sync'>('connect');
  const [token, setToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [user, setUser] = useState<GithubUser | null>(null);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [dir, setDir] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getGithubToken().then((t) => {
      setToken(t);
      if (t) validateToken(t).then(setUser).catch(() => {});
    });
    getGithubClientId().then(setClientId);
    return () => { try { abortRef.current?.abort(); } catch { /* noop */ } };
  }, []);

  function say(m: string) {
    setLog((l) => [...l.slice(-50), `${new Date().toLocaleTimeString()} ${m}`]);
  }

  async function connectPat() {
    if (!token.trim()) return;
    setBusy(true);
    try {
      const u = await validateToken(token.trim());
      setUser(u);
      await saveGithubToken(token.trim());
      say(`✅ Signed in as ${u.login}`);
      const rs = await listRepos(token.trim());
      setRepos(rs);
      setTab('sync');
    } catch (e) {
      say(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function startOAuth() {
    const id = clientId.trim();
    if (!id) { say('⚠️ Enter your OAuth App client ID first (BYOK style — create one at github.com/settings/developers).'); return; }
    saveGithubClientId(id);
    setBusy(true);
    try {
      const dc = await startDeviceFlow(id);
      setDevice(dc);
      say(`🔑 Enter code ${dc.user_code} at ${dc.verification_uri}`);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const access = await pollDeviceToken(id, dc.device_code, dc.interval, ctrl.signal);
      setToken(access);
      await saveGithubToken(access);
      const u = await validateToken(access);
      setUser(u);
      say(`✅ Signed in as ${u.login}`);
      setDevice(null);
      const rs = await listRepos(access);
      setRepos(rs);
      setTab('sync');
    } catch (e) {
      say(`❌ ${e instanceof Error ? e.message : String(e)}`);
      setDevice(null);
    } finally {
      setBusy(false);
    }
  }

  function pickRepo(full: string) {
    const [o, r] = full.split('/');
    setOwner(o || '');
    setRepo(r || '');
    setBranch('');
    setBranches([]);
    if (o && r && token) {
      listRemoteBranches(o, r, token).then((bs) => {
        setBranches(bs);
        if (bs.length > 0) setBranch(bs[0]);
      }).catch((e) => say(`❌ branches: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  async function doClone() {
    if (!owner || !repo || !token) { say('⚠️ Owner, repo and token required.'); return; }
    setBusy(true);
    try {
      const res = await cloneDocs({ owner, repo, branch: branch || undefined, token, onProgress: say });
      setDir(res.dir);
      setBranch(res.branch);
      say(`✅ Cloned ${res.docs.length} doc file(s) on ${res.branch}`);
      if (res.docs.length > 0) {
        onImportFiles(res.docs);
        say('📥 Imported into project (existing files replaced).');
      } else {
        say('ℹ️ No .md/.tex/.typ files found — push will add project files.');
      }
    } catch (e) {
      say(`❌ clone: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function doPush() {
    if (!dir) { say('⚠️ Clone a repo first — push reuses the cloned workspace.'); return; }
    if (!token) { say('⚠️ Not signed in.'); return; }
    setBusy(true);
    try {
      await ensureBranch({ dir, branch: branch || 'main' });
      const login = user?.login || 'dexter-write';
      const sha = await pushDocs({
        dir,
        branch: branch || 'main',
        token,
        message: message.trim() || `Update from Dexter Write (${files.length} files)`,
        author: { name: getSelfName(), email: `${login}@users.noreply.github.com` },
        docs: files.map((f) => ({ path: f.name, content: f.content })),
        onProgress: say,
      });
      say(`✅ Pushed commit ${sha.slice(0, 7)} to ${owner}/${repo}@${branch}`);
    } catch (e) {
      say(`❌ push: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="GitHub sync">
        <ModalHeader icon="github" title="GitHub Sync" category="Sync" sub={user ? `Signed in as ${user.login}` : 'Clone, commit and push repositories directly from the browser.'} onClose={onClose} />
        <div className="modal-body">
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          <button className={tab === 'connect' ? 'active' : ''} onClick={() => setTab('connect')}>Connect</button>
          <button className={tab === 'sync' ? 'active' : ''} onClick={() => setTab('sync')}>Sync</button>
        </div>

        {tab === 'connect' && (
          <div>
            <label>Fine-grained Personal Access Token (contents: read/write)</label>
            <div className="row">
              <input type={showToken ? 'text' : 'password'} value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" style={{ flex: 1 }} />
              <button className="btn" onClick={() => setShowToken(!showToken)}>{showToken ? 'Hide' : 'Show'}</button>
              <button className="btn primary" disabled={busy} onClick={connectPat}>Sign in</button>
            </div>
            <p className="muted small">Token is AES-GCM encrypted in the BYOK vault. Or use OAuth device flow:</p>
            <label>OAuth App Client ID (optional, BYOK)</label>
            <div className="row">
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Ov23…" style={{ flex: 1 }} />
              <button className="btn" disabled={busy} onClick={startOAuth}>Device login</button>
            </div>
            {device && (
              <div className="sel-chip">
                <span>Enter <strong>{device.user_code}</strong> at <strong>{device.verification_uri}</strong> — waiting…</span>
                <button className="btn xs danger" onClick={() => { abortRef.current?.abort(); setDevice(null); }}>Cancel</button>
              </div>
            )}
            <div className="row end">
              <button className="btn danger" onClick={() => { saveGithubToken(''); setToken(''); setUser(null); }}>Sign out</button>
            </div>
          </div>
        )}

        {tab === 'sync' && (
          <div>
            {!user && <p className="muted">⚠️ Sign in first (Connect tab).</p>}
            <label>Repository</label>
            <div className="row">
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" aria-label="Owner" />
              <span>/</span>
              <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo" aria-label="Repo" style={{ flex: 1 }} />
            </div>
            {repos.length > 0 && (
              <select value={owner && repo ? `${owner}/${repo}` : ''} onChange={(e) => pickRepo(e.target.value)} aria-label="Pick a repo">
                <option value="">Pick from your repos…</option>
                {repos.slice(0, 100).map((r) => <option key={r.full_name} value={r.full_name}>{r.full_name}{r.private ? ' (private)' : ''}</option>)}
              </select>
            )}
            <label>Branch</label>
            <div className="row">
              <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" list="gh-branches" style={{ flex: 1 }} />
              <datalist id="gh-branches">{branches.map((b) => <option key={b} value={b} />)}</datalist>
              <button className="btn primary" disabled={busy} onClick={doClone}>{busy ? 'Working…' : 'Clone / Pull'}</button>
            </div>
            <label>Commit message</label>
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Update from Dexter Write" />
            <div className="row">
              <button className="btn primary" disabled={busy || !dir} onClick={doPush}>{busy ? 'Working…' : 'Commit + Push'}</button>
              {!dir && <span className="muted small">Clone first to enable push.</span>}
            </div>
            <label>Log</label>
            <pre className="gh-log">{log.length === 0 ? '(no activity yet)' : log.join('\n')}</pre>
          </div>
        )}

        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
