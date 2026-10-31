import { useCallback, useEffect, useState } from 'react';
import type { ProjectAsset } from '../lib/assets';
import type { ProjectFile } from '../lib/projectFiles';
import {
  deleteCloudProject,
  getCloudAccount,
  importProject,
  listCloudProjects,
  listRecentRevisions,
  loadProject,
  onCloudAuthChange,
  pushProject,
  restoreCloudRevision,
  signInWithGitHub,
  signOutFromCloud,
  type CloudAccount,
  type CloudProject,
  type CloudRevision,
} from '../lib/cloud/cloudStore';
import { cloudConfigured, mcpEndpoint } from '../lib/cloud/supabase';
import { askConfirm } from '../lib/dialog';
import Icon from './icons';
import ModalHeader from './ModalHeader';

interface Props {
  files: ProjectFile[];
  assets: ProjectAsset[];
  activeName: string;
  localProjectId: string;
  onLoad: (files: ProjectFile[], assets: ProjectAsset[], activeName: string) => Promise<void> | void;
  onLink: (projectId: string) => void;
  onClose: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultProjectName(files: ProjectFile[], activeName: string): string {
  if (activeName) {
    const dot = activeName.lastIndexOf('.');
    return dot > 0 ? activeName.slice(0, dot) : activeName;
  }
  const first = files[0]?.name ?? 'Untitled project';
  const dot = first.lastIndexOf('.');
  return dot > 0 ? first.slice(0, dot) : first;
}

function formatUpdated(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString();
}

export default function CloudPanel({ files, assets, activeName, localProjectId, onLoad, onLink, onClose }: Props) {
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [revisions, setRevisions] = useState<CloudRevision[]>([]);
  const [name, setName] = useState(() => defaultProjectName(files, activeName));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    if (!cloudConfigured) return;
    try {
      const next = await getCloudAccount();
      setAccount(next);
      if (next?.allowed) {
        const [nextProjects, nextRevisions] = await Promise.all([listCloudProjects(), listRecentRevisions()]);
        setProjects(nextProjects);
        setRevisions(nextRevisions);
      } else {
        setProjects([]);
        setRevisions([]);
      }
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onCloudAuthChange(() => { void refresh(); });
  }, [refresh]);

  async function run(label: string, action: () => Promise<void>): Promise<void> {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const handleSignIn = () => run('signin', async () => {
    await signInWithGitHub();
  });

  const handleSignOut = () => run('signout', async () => {
    await signOutFromCloud();
    setAccount(null);
    setProjects([]);
    setRevisions([]);
  });

  const handleImport = () => run('import', async () => {
    const id = await importProject({ name, files, assets, activeName });
    onLink(id);
    setProjects(await listCloudProjects());
    setNotice(`Imported ${files.length} file${files.length === 1 ? '' : 's'} and ${assets.length} image${assets.length === 1 ? '' : 's'} into the cloud (${id.slice(0, 8)}).`);
  });

  const handlePush = (project: CloudProject) => run(`push:${project.id}`, async () => {
    await pushProject(project.id, files, activeName, assets);
    onLink(project.id);
    setProjects(await listCloudProjects());
    setNotice(`Pushed the local tree to �?o${project.name}�??. Any cloud-only files were removed.`);
  });

  const handleLoad = (project: CloudProject) => run(`load:${project.id}`, async () => {
    const bundle = await loadProject(project.id, localProjectId);
    await onLoad(bundle.files, bundle.assets, bundle.activeName ?? bundle.files[0]?.name ?? '');
    onLink(project.id);
    const warning = bundle.warnings.length > 0 ? ` ${bundle.warnings.length} image${bundle.warnings.length === 1 ? '' : 's'} could not be downloaded.` : '';
    setNotice(`Loaded “${project.name}” with ${bundle.files.length} files and ${bundle.assets.length} images.${warning}`);
  });

  const handleDelete = async (project: CloudProject) => {
    const proceed = await askConfirm({
      title: `Delete “${project.name}”?`,
      message: 'The cloud copy will be removed. The local copy stays on this device.',
      confirmLabel: 'Delete from cloud',
      danger: true,
    });
    if (!proceed) return;
    void run(`delete:${project.id}`, async () => {
      await deleteCloudProject(project.id);
      setProjects(await listCloudProjects());
      setNotice(`Deleted “${project.name}” from the cloud.`);
    });
  };

  const copyMcpUrl = async () => {
    const url = mcpEndpoint();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Remote MCP URL copied. Paste it into Claude or ChatGPT as a custom connector.');
    } catch (e) {
      setError(`Could not copy: ${errorMessage(e)}`);
    }
  };

  const projectName = (projectId: string): string =>
    projects.find((project) => project.id === projectId)?.name ?? projectId.slice(0, 8);

  const handleUndo = (revision: CloudRevision) => {
    void run(`undo:${revision.id}`, async () => {
      const restored = await restoreCloudRevision(revision.id);
      await refresh();
      setNotice(restored.deleted
        ? `Undid the creation of ${restored.path}. Load the project from cloud to refresh the editor.`
        : `Restored ${restored.path} to its previous version (v${restored.version}). Load the project from cloud to refresh the editor.`);
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Cloud and remote MCP">
        <ModalHeader
          icon="cloud"
          title="Cloud & Remote MCP"
          category="Connected"
          sub="Sync this project to Supabase so Claude and ChatGPT can read and edit it directly, with revision undo."
          onClose={onClose}
        />
        <div className="modal-body">
          <div className="cloud-hero">
            <span className="cloud-hero-icon"><Icon name="cloud" size={18} /></span>
            <div style={{ minWidth: 0 }}>
              <h3>One connector, any MCP client</h3>
              <p className="muted small" style={{ margin: 0 }}>
                The browser keeps working offline. Cloud sync only moves project files and images into your own Supabase project.
              </p>
            </div>
          </div>

          {!cloudConfigured && (
            <div className="cloud-card">
              <h3>Enable cloud sync</h3>
              <p className="muted small" style={{ margin: 0 }}>
                Create a free Supabase project, run <code>supabase/migrations/0001_init.sql</code>, then add these to <code>.env</code> and rebuild.
              </p>
              <pre className="cloud-code">{`VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`}</pre>
              <p className="cloud-foot-note">
                The anon key is public by design. Row level security and the GitHub allowlist protect every row and storage object.
              </p>
            </div>
          )}

          {cloudConfigured && !account && (
            <div className="cloud-card">
              <h3>Sign in with GitHub</h3>
              <p className="muted small" style={{ margin: 0 }}>
                Only GitHub usernames in <code>allowed_users</code> can open cloud projects. The allowlist is checked again on every request.
              </p>
              <div className="cloud-signin">
                <button className="btn primary" onClick={handleSignIn} disabled={busy !== null}>
                  <Icon name="github" size={14} />
                  {busy === 'signin' ? 'Opening GitHub…' : 'Continue with GitHub'}
                </button>
              </div>
            </div>
          )}

          {account && (
            <>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 0 }}>
                <div>
                  <strong>@{account.username}</strong>
                  <span className={`cloud-badge ${account.allowed ? 'ok' : ''}`} style={{ marginLeft: 8 }}>
                    {account.allowed ? 'Allowed' : 'Not allowed'}
                  </span>
                </div>
                <button className="btn xs" onClick={handleSignOut} disabled={busy !== null}>
                  <Icon name="logout" size={13} /> Sign out
                </button>
              </div>

              {!account.allowed && (
                <div className="cloud-warning">
                  Your GitHub username is not on the allowlist. Add it in the Supabase SQL editor:
                  <pre className="cloud-code">{`insert into public.allowed_users (github_username, note)
values ('${account.username.toLowerCase()}', 'owner')
on conflict (github_username) do nothing;`}</pre>
                  Then sign out and sign back in.
                </div>
              )}

              {account.allowed && (
                <>
                  <div className="cloud-card">
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: 0 }}>
                      <h3>Remote MCP endpoint</h3>
                      <button className="btn xs" onClick={copyMcpUrl} disabled={!mcpEndpoint()}>
                        Copy URL
                      </button>
                    </div>
                    <p className="muted small" style={{ margin: 0 }}>
                      Add this URL as a custom connector in Claude or ChatGPT. Edits apply immediately and stay undoable here.
                    </p>
                    <pre className="cloud-code">{mcpEndpoint() ?? 'Cloud sync is not configured in this build.'}</pre>
                  </div>

                  <div className="cloud-card">
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: 0 }}>
                      <h3>Recent MCP edits</h3>
                      <button className="btn xs ghost" onClick={() => void run('refresh-edits', refresh)} disabled={busy !== null}>
                        <Icon name="refresh" size={13} /> Refresh
                      </button>
                    </div>
                    {revisions.length === 0 ? (
                      <div className="cloud-empty">No MCP edits yet. Ask Claude or ChatGPT to edit a file; changes apply immediately.</div>
                    ) : (
                      <div className="cloud-pending">
                        {revisions.map((revision) => (
                          <div className="cloud-pending-item" key={revision.id}>
                            <div className="cloud-pending-head">
                              <div style={{ minWidth: 0 }}>
                                <strong>{revision.path}</strong>
                                <span className="muted small"> · {projectName(revision.projectId)} · {revision.version === 0 ? 'created' : `before v${revision.version}`} · {formatUpdated(revision.createdAt)}</span>
                              </div>
                              <div className="cloud-item-actions">
                                <button className="btn xs" onClick={() => handleUndo(revision)} disabled={busy !== null}>
                                  <Icon name="undo" size={12} /> {busy === `undo:${revision.id}` ? 'Restoring…' : 'Undo'}
                                </button>
                              </div>
                            </div>
                            <p className="cloud-pending-summary">{revision.summary || 'AI edit'}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="cloud-card">
                    <h3>Send this project to the cloud</h3>
                    <label htmlFor="cloud-project-name">Cloud project name</label>
                    <input
                      id="cloud-project-name"
                      value={name}
                      maxLength={120}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Research paper"
                    />
                    <div className="row">
                      <button className="btn primary" onClick={handleImport} disabled={busy !== null || files.length === 0}>
                        {busy === 'import' ? 'Uploading…' : 'Import current project'}
                      </button>
                      <span className="muted small">{files.length} files · {assets.length} images</span>
                    </div>
                  </div>

                  <div className="cloud-card">
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: 0 }}>
                      <h3>Cloud projects</h3>
                      <button className="btn xs ghost" onClick={() => void run('refresh', async () => { setProjects(await listCloudProjects()); })} disabled={busy !== null}>
                        <Icon name="refresh" size={13} /> Refresh
                      </button>
                    </div>
                    {projects.length === 0 ? (
                      <div className="cloud-empty">No cloud projects yet. Import the open project above.</div>
                    ) : (
                      <div className="cloud-list">
                        {projects.map((project) => (
                          <div className="cloud-item" key={project.id}>
                            <div className="cloud-item-main">
                              <strong>{project.name}</strong>
                              <span className="muted small">Updated {formatUpdated(project.updatedAt)}</span>
                            </div>
                            <div className="cloud-item-actions">
                              <button className="btn xs" onClick={() => handleLoad(project)} disabled={busy !== null}>
                                {busy === `load:${project.id}` ? 'Loading…' : 'Load'}
                              </button>
                              <button className="btn xs" onClick={() => handlePush(project)} disabled={busy !== null} title="Replace the cloud file tree with this local one">
                                {busy === `push:${project.id}` ? 'Pushing…' : 'Push'}
                              </button>
                              <button className="btn xs danger" onClick={() => handleDelete(project)} disabled={busy !== null}>
                                <Icon name="trash" size={12} /> Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {notice && <p className="small" style={{ color: 'var(--muted)', marginBottom: 0 }}>{notice}</p>}
          {error && <div className="cloud-warning">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
