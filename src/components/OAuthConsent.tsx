import { useEffect, useState } from 'react';
import {
  activateMcpProjectGrant,
  discardPendingMcpGrant,
  getCloudAccount,
  listCloudProjects,
  prepareMcpProjectGrant,
  signInWithGitHub,
  type CloudAccount,
  type CloudProject,
} from '../lib/cloud/cloudStore';
import { cloudConfigured, requireSupabase } from '../lib/cloud/supabase';
import Icon from './icons';

interface ConsentDetails {
  authorization_id: string;
  redirect_uri: string;
  client: { id: string; name: string; uri: string; logo_uri: string };
  user: { id: string; email: string };
  scope: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const workspaceUrl = import.meta.env.BASE_URL;

async function finishAuthorization(authorizationId: string) {
  const redirect = await activateMcpProjectGrant(authorizationId);
  if (!redirect) throw new Error('Project access could not be completed. Remove the request in Connections and start again from the client.');
  window.location.assign(redirect);
}

export default function OAuthConsent() {
  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id') ?? '';
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [finishPending, setFinishPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'signin' | 'approve' | 'deny' | 'refresh' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!cloudConfigured) throw new Error('Cloud sync is not configured in this deployment.');
        if (!authorizationId) throw new Error('This authorization link is missing its authorization_id.');

        const next = await getCloudAccount();
        if (!active) return;
        setAccount(next);
        if (!next || !next.allowed) {
          setLoading(false);
          return;
        }

        const db = requireSupabase();
        const { data, error: detailsError } = await db.auth.oauth.getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (detailsError && detailsError.status !== 400 && detailsError.status !== 404) throw detailsError;
        // Supabase refuses to return details for an already approved request.
        // Recover its existing code only after the database validates the grant.
        if (detailsError || 'redirect_url' in data) {
          setFinishPending(true);
          await finishAuthorization(authorizationId);
          return;
        }
        setDetails(data as ConsentDetails);
        const available = await listCloudProjects();
        if (!active) return;
        setProjects(available);
        setLoading(false);
      } catch (e) {
        if (!active) return;
        setError(errorMessage(e));
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [authorizationId]);

  async function handleSignIn() {
    setBusy('signin');
    setError('');
    try {
      await signInWithGitHub(window.location.href);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  async function decide(action: 'approve' | 'deny') {
    if (!details || (action === 'approve' && !projectId)) return;
    setBusy(action);
    setError('');
    const clientId = details.client.id;
    try {
      const db = requireSupabase();
      if (action === 'approve') {
        await prepareMcpProjectGrant({ clientId, projectId, canEdit, authorizationId });
      }
      const options = { skipBrowserRedirect: true };
      const result = action === 'approve'
        ? await db.auth.oauth.approveAuthorization(authorizationId, options)
        : await db.auth.oauth.denyAuthorization(authorizationId, options);
      if (result.error) {
        const status = result.error.status;
        if (action === 'approve' && status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          await discardPendingMcpGrant(clientId, authorizationId);
          throw result.error;
        }
        throw new Error(`${result.error.message} Reload this page to check whether authorization succeeded.`);
      }
      if (action === 'approve') {
        setFinishPending(true);
        await finishAuthorization(authorizationId);
      } else {
        if (!result.data?.redirect_url) throw new Error('Supabase did not return a redirect URL.');
        window.location.assign(result.data.redirect_url);
      }
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  async function resumeAuthorization() {
    setBusy('approve');
    setError('');
    try {
      await finishAuthorization(authorizationId);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  async function refreshProjects() {
    setBusy('refresh');
    setError('');
    try {
      setProjects(await listCloudProjects());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const scopes = details?.scope?.split(/\s+/).filter(Boolean) ?? [];

  return (
    <div className="consent-page">
      <div className="consent-card">
        <div className="consent-brand">
          <span className="brand-mark"><Icon name="bolt" size={13} /></span>
          <span>Dexter Write</span>
        </div>

        <h1>Connect an AI client</h1>
        <p className="muted small">
          Choose one cloud project for this client. You can manage or revoke its access in Connections.
        </p>

        {loading && <p className="consent-status">Checking the authorization request…</p>}
        {error && <div className="cloud-warning" role="alert">{error}</div>}

        {!loading && cloudConfigured && authorizationId && !account && (
          <div className="consent-block">
            <p className="small">Sign in with GitHub to see which client is requesting access.</p>
            <button className="btn primary" onClick={handleSignIn} disabled={busy !== null}>
              <Icon name="github" size={14} />
              {busy === 'signin' ? 'Opening GitHub…' : 'Continue with GitHub'}
            </button>
          </div>
        )}

        {!loading && account && !account.allowed && (
          <div className="consent-block">
            <div className="cloud-warning">
              @{account.username} is not on this Dexter Write allowlist, so the connection would fail anyway.
              Ask the owner to add your GitHub username, then retry from the client.
            </div>
          </div>
        )}

        {!loading && finishPending && (
          <div className="consent-block">
            <p className="small">Finish setting up project access to return to the client.</p>
            <div className="row">
              <button className="btn primary" disabled={busy !== null} onClick={() => void resumeAuthorization()}>
                {busy === 'approve' ? 'Finishing…' : 'Finish connection'}
              </button>
              <a className="btn" href={`${workspaceUrl}?connections=1`}>Manage connections</a>
            </div>
          </div>
        )}

        {!loading && !finishPending && account?.allowed && details && (
          <>
            <div className="consent-client">
              <div className="consent-client-icon"><Icon name="plug" size={18} /></div>
              <div style={{ minWidth: 0 }}>
                <strong>{details.client.name || 'Unnamed MCP client'}</strong>
                {details.client.uri && <span className="muted small">{details.client.uri}</span>}
              </div>
            </div>

            <dl className="consent-facts">
              <div>
                <dt>Signed in as</dt>
                <dd>{details.user.email || account.username}</dd>
              </div>
              <div>
                <dt>Redirects to</dt>
                <dd className="consent-mono">{details.redirect_uri}</dd>
              </div>
              <div>
                <dt>Identity scopes</dt>
                <dd>
                  <div className="consent-scopes">
                    {scopes.length === 0 && <span className="muted">None listed</span>}
                    {scopes.map((scope) => (
                      <span className="consent-scope" key={scope}>{scope}</span>
                    ))}
                  </div>
                  <p className="muted small">Identity scopes share account information. Dexter project permissions separately control database access.</p>
                </dd>
              </div>
            </dl>

            <section className="cloud-card consent-block" aria-labelledby="dexter-access-title">
              <h3 id="dexter-access-title">Dexter project access</h3>
              {projects.length > 0 ? (
                <>
                  <label htmlFor="consent-project">Cloud project</label>
                  <select id="consent-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={busy !== null}>
                    <option value="">Select a project</option>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                  <p className="muted small">The client can read and search files and compile LaTeX when cloud compilation is available.</p>
                  <label>
                    <input type="checkbox" checked={canEdit} onChange={(e) => setCanEdit(e.target.checked)} disabled={busy !== null} />
                    {' '}Allow edits to project files
                  </label>
                  <p className="muted small">If allowed, file creation and edits apply immediately. You can undo them from cloud revision history.</p>
                </>
              ) : (
                <>
                  <p className="muted small">Sync a project before approving this connection.</p>
                  <div className="row">
                    <a className="btn" href={`${workspaceUrl}?cloud-sync=1`} target="_blank" rel="noreferrer">Sync this project</a>
                    <button className="btn" onClick={() => void refreshProjects()} disabled={busy !== null}>Refresh projects</button>
                  </div>
                </>
              )}
            </section>

            <p className="consent-note">
              Only approve if you started this connection from a client you trust.
            </p>

            <div className="consent-actions">
              <button className="btn" onClick={() => decide('deny')} disabled={busy !== null}>
                {busy === 'deny' ? 'Denying…' : 'Deny'}
              </button>
              <button className="btn primary" onClick={() => decide('approve')} disabled={busy !== null || !projectId}>
                {busy === 'approve' ? 'Approving…' : 'Approve connection'}
              </button>
            </div>
          </>
        )}

        <a className="consent-back" href={workspaceUrl}>Back to Dexter Write</a>
      </div>
    </div>
  );
}
