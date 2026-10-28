import { useCallback, useEffect, useState } from 'react';
import type { ProjectAsset } from '../lib/assets';
import type { ProjectFile } from '../lib/projectFiles';
import {
  acceptStagedEdit,
  deleteCloudProject,
  getCloudAccount,
  getStagedEdit,
  importProject,
  listCloudProjects,
  listPendingEdits,
  loadProject,
  onCloudAuthChange,
  pushProject,
  rejectStagedEdit,
  signInWithGitHub,
  signOutFromCloud,
  type CloudAccount,
  type CloudProject,
  type CloudStagedEdit,
} from '../lib/cloud/cloudStore';
import { cloudConfigured, mcpEndpoint } from '../lib/cloud/supabase';
import Icon from './icons';
import ModalHeader from './ModalHeader';

interface Props {
  files: ProjectFile[];
  assets: ProjectAsset[];
  activeName: string;
  localProjectId: string;
  onLoad: (files: ProjectFile[], assets: ProjectAsset[], activeName: string) => Promise<void> | void;
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

export default function CloudPanel({ files, assets, activeName, localProjectId, onLoad, onClose }: Props) {
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [pending, setPending] = useState<CloudStagedEdit[]>([]);
  const [preview, setPreview] = useState<{ id: string; content: string } | null>(null);
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
        const [nextProjects, nextPending] = await Promise.all([listCloudProjects(), listPendingEdits()]);
        setProjects(nextProjects);
        setPending(nextPending);
      } else {
        setProjects([]);
        setPending([]);
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
    setPending([]);
    setPreview(null);
  });

  const handleImport = () => run('import', async () => {
    const id = await importProject({ name, files, assets, activeName });
    setProjects(await listCloudProjects());
    setNotice(`Imported ${files.length} file${files.length === 1 ? '' : 's'} and ${assets.length} image${assets.length === 1 ? '' : 's'} into the cloud (${id.slice(0, 8)}).`);
  });

  const handlePush = (project: CloudProject) => run(`push:${project.id}`, async () => {
    await pushProject(project.id, files, activeName, assets);
    setProjects(await listCloudProjects());
    setNotice(`Pushed the local tree to “${project.name}”. Any cloud-only files were removed.`);
  });

  const handleLoad = (project: CloudProject) => run(`load:${project.id}`, async () => {
    const bundle = await loadProject(project.id, localProjectId);
    await onLoad(bundle.files, bundle.assets, bundle.activeName ?? bundle.files[0]?.name ?? '');
    const warning = bundle.warnings.length > 0 ? ` ${bundle.warnings.length} image${bundle.warnings.length === 1 ? '' : 's'} could not be downloaded.` : '';
    setNotice(`Loaded “${project.name}” with ${bundle.files.length} files and ${bundle.assets.length} images.${warning}`);
  });

  const handleDelete = (project: CloudProject) => {
    if (!window.confirm(`Delete “${project.name}” from the cloud? The local copy stays on this device.`)) return;
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

  const handlePreview = (edit: CloudStagedEdit) => run(`preview:${edit.id}`, async () => {
    if (preview?.id === edit.id) {
      setPreview(null);
      return;
    }
    const detail = await getStagedEdit(edit.id);
    setPreview({ id: edit.id, content: detail.newContent });
  });

  const handleAccept = (edit: CloudStagedEdit) => {
    if (!window.confirm(`Accept the AI edit to “${edit.path}”?\n\n${edit.summary}`)) return;
    void run(`accept:${edit.id}`, async () => {
      const accepted = await acceptStagedEdit(edit.id);
      setPreview(null);
      await refresh();
      setNotice(`Accepted ${accepted.path} (version ${accepted.version}). Load “${projectName(edit.projectId)}” to see it in the editor.`);
    });
  };

  const handleReject = (edit: CloudStagedEdit) => {
    void run(`reject:${edit.id}`, async () => {
      await rejectStagedEdit(edit.id);
      setPreview(null);
      await refresh();
      setNotice(`Rejected the AI edit to ${edit.path}.`);
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Cloud and remote MCP">
        <ModalHeader
          icon="cloud"
          title="Cloud & Remote MCP"
          category="Connected"
          sub="Sync this project to Supabase so Claude and ChatGPT can read it and stage edits."
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
                  <strong style={{ fontFamily: 'var(--display)' }}>@{account.username}</strong>
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
                    <h3>Remote MCP URL</h3>
                    <p className="muted small" style={{ margin: 0 }}>
                      Add this as a custom connector in Claude or ChatGPT. OAuth uses your Supabase project; no API key to paste.
                    </p>
                    <div className="cloud-url">
                      <code>{mcpEndpoint() ?? 'Run supabase functions deploy mcp first.'}</code>
                      <button className="btn xs" onClick={copyMcpUrl} disabled={!mcpEndpoint()}>
                        <Icon name="copy" size={13} /> Copy
                      </button>
                    </div>
                  </div>

                  <div className="cloud-card">
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: 0 }}>
                      <h3>Pending AI edits</h3>
                      <button className="btn xs ghost" onClick={() => void run('refresh-edits', refresh)} disabled={busy !== null}>
                        <Icon name="refresh" size={13} /> Refresh
                      </button>
                    </div>
                    {pending.length === 0 ? (
                      <div className="cloud-empty">No edits waiting. Ask Claude or ChatGPT to stage one with the remote MCP connector.</div>
                    ) : (
                      <div className="cloud-pending">
                        {pending.map((edit) => (
                          <div className="cloud-pending-item" key={edit.id}>
                            <div className="cloud-pending-head">
                              <div style={{ minWidth: 0 }}>
                                <strong>{edit.path}</strong>
                                <span className="muted small"> · {projectName(edit.projectId)} · base v{edit.baseVersion}</span>
                              </div>
                              <div className="cloud-item-actions">
                                <button className="btn xs" onClick={() => handlePreview(edit)} disabled={busy !== null}>
                                  {preview?.id === edit.id ? 'Hide' : 'View'}
                                </button>
                                <button className="btn xs primary" onClick={() => handleAccept(edit)} disabled={busy !== null}>
                                  {busy === `accept:${edit.id}` ? 'Accepting…' : 'Accept'}
                                </button>
                                <button className="btn xs danger" onClick={() => handleReject(edit)} disabled={busy !== null}>
                                  {busy === `reject:${edit.id}` ? 'Rejecting…' : 'Reject'}
                                </button>
                              </div>
                            </div>
                            <p className="cloud-pending-summary">{edit.summary}</p>
                            {preview?.id === edit.id && (
                              <pre className="cloud-preview">{preview.content.slice(0, 20_000)}{preview.content.length > 20_000 ? '\n\n[preview truncated at 20,000 characters]' : ''}</pre>
                            )}
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

          {notice && <p className="small" style={{ color: 'var(--accent2)', marginBottom: 0 }}>{notice}</p>}
          {error && <div className="cloud-warning">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
