import { useCallback, useEffect, useState } from 'react';
import {
  getCloudAccount,
  listCloudProjects,
  listMcpConnections,
  revokeMcpConnection,
  setMcpConnectionCanEdit,
  type CloudAccount,
  type CloudProject,
  type McpConnection,
} from '../lib/cloud/cloudStore';
import { cloudConfigured, mcpEndpoint } from '../lib/cloud/supabase';
import McpManager, { type McpManagerProps } from './McpManager';
import ModalHeader from './ModalHeader';

interface Props extends Omit<McpManagerProps, 'section'> {
  cloudProjectId: string;
  onOpenCloud: () => void;
  onClose: () => void;
}

const SECTIONS = [
  { id: 'hosted', label: 'Cloud project' },
  { id: 'local', label: 'Local bridge' },
  { id: 'custom', label: 'Custom servers' },
] as const;

function HostedConnections({ cloudProjectId, onOpenCloud }: Pick<Props, 'cloudProjectId' | 'onOpenCloud'>) {
  const [loading, setLoading] = useState(cloudConfigured);
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const endpoint = mcpEndpoint();

  const refresh = useCallback(async () => {
    if (!cloudConfigured) return;
    try {
      const nextAccount = await getCloudAccount();
      setAccount(nextAccount);
      if (nextAccount?.allowed) {
        const [nextProjects, nextConnections] = await Promise.all([listCloudProjects(), listMcpConnections()]);
        setProjects(nextProjects);
        setConnections(nextConnections);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function copyUrl() {
    if (!endpoint) return;
    setError('');
    try {
      await navigator.clipboard.writeText(endpoint);
      setNotice('Connector URL copied.');
    } catch {
      setError('Clipboard access failed. You can select and copy the URL below.');
    }
  }

  async function changeAccess(action: () => Promise<void>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await refresh();
      setNotice(message);
    } catch (e) {
      await refresh();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirmRevoke(null);
    }
  }

  return (
    <>
      <div className="cloud-card">
        <h3>Connect an AI client</h3>
        <p className="muted small">
          Add Dexter Write as a custom MCP server in a compatible client. When prompted, sign in and choose the cloud project it can access.
          Allow file edits separately. Edits apply immediately and can be undone in Cloud sync.
        </p>
        {loading && <p className="muted small" role="status">Checking cloud access…</p>}
        {!loading && !cloudConfigured && <p className="muted small">Cloud sync is unavailable in this build.</p>}
        {!loading && cloudConfigured && !account?.allowed && (
          <button className="btn primary" onClick={onOpenCloud}>Open Cloud sync</button>
        )}
        {!loading && account?.allowed && !projects.some((project) => project.id === cloudProjectId) && (
          <div className="row">
            <p className="muted small">The project open in the editor is local.</p>
            <button className="btn" onClick={onOpenCloud}>Sync this project</button>
          </div>
        )}
        {account?.allowed && projects.length > 0 && endpoint && (
          <>
            <pre className="cloud-code">{endpoint}</pre>
            <button className="btn primary" onClick={() => void copyUrl()}>Copy connector URL</button>
          </>
        )}
      </div>

      {account?.allowed && !loading && (
        <div className="cloud-card">
          <h3>Authorized clients</h3>
          {connections.length === 0 && !error && <p className="muted small">No AI clients authorized yet.</p>}
          {connections.map((connection) => {
            const projectId = connection.projectId;
            const project = projects.find((item) => item.id === projectId);
            return (
              <div className="cloud-pending-item" key={connection.clientId}>
                <div className="cloud-pending-head">
                  <strong>{connection.name}</strong>
                  {project && <span className="cloud-badge">{connection.canEdit ? 'Can edit' : 'Read only'}</span>}
                </div>
                {project ? (
                  <p className="muted small">Project · {project.name}</p>
                ) : (
                  <p className="muted small">No project access. Remove this connection and authorize again from the client.</p>
                )}
                {connection.grantedAt && (
                  <p className="muted small">
                    Identity scopes · {connection.scopes.join(', ') || 'None listed'}
                    {' · '}Authorized {new Date(connection.grantedAt).toLocaleDateString()}
                  </p>
                )}
                <div className="row">
                  {projectId && project && (
                    <label>
                      <input
                        type="checkbox"
                        checked={connection.canEdit}
                        disabled={busy}
                        onChange={(e) => {
                          const canEdit = e.target.checked;
                          void changeAccess(
                            () => setMcpConnectionCanEdit(connection.clientId, projectId, canEdit),
                            canEdit ? 'File edits enabled.' : 'File edits disabled.',
                          );
                        }}
                      />
                      {' '}Allow edits to project files
                    </label>
                  )}
                  {confirmRevoke === connection.clientId ? (
                    <>
                      <button className="btn xs" onClick={() => setConfirmRevoke(null)} disabled={busy}>Cancel</button>
                      <button className="btn xs danger" disabled={busy} onClick={() => void changeAccess(
                        () => revokeMcpConnection(connection), 'Connection removed.',
                      )}>Confirm revoke</button>
                    </>
                  ) : (
                    <button className="btn xs" disabled={busy} onClick={() => setConfirmRevoke(connection.clientId)}>
                      {connection.grantedAt ? 'Revoke access' : 'Remove request'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {notice && <p className="muted small" role="status">{notice}</p>}
      {error && <div className="cloud-warning" role="alert">{error}</div>}
    </>
  );
}

export default function ConnectionsModal({ cloudProjectId, onOpenCloud, onClose, ...mcp }: Props) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]['id']>('hosted');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Connections">
        <ModalHeader
          icon="plug"
          title="Connections"
          sub="Connect a client to Dexter Write or add tools for the Dexter Assistant."
          onClose={onClose}
        />
        <div className="modal-body">
          <div className="seg connections-sections" role="group" aria-label="Connection type">
            {SECTIONS.map(({ id, label }) => (
              <button key={id} className={section === id ? 'active' : ''} aria-pressed={section === id} onClick={() => setSection(id)}>
                {label}
              </button>
            ))}
          </div>
          {section === 'hosted'
            ? <HostedConnections cloudProjectId={cloudProjectId} onOpenCloud={onOpenCloud} />
            : <McpManager {...mcp} section={section} />}
        </div>
      </div>
    </div>
  );
}
