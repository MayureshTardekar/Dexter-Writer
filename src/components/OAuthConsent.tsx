import { useEffect, useState } from 'react';
import {
  getCloudAccount,
  signInWithGitHub,
  type CloudAccount,
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

export default function OAuthConsent() {
  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id') ?? '';
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'signin' | 'approve' | 'deny' | null>(null);
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
        if (detailsError) throw new Error(detailsError.message);
        if ('redirect_url' in data) {
          window.location.assign(data.redirect_url);
          return;
        }
        if (!active) return;
        setDetails(data as ConsentDetails);
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
    setBusy(action);
    setError('');
    try {
      const db = requireSupabase();
      const result = action === 'approve'
        ? await db.auth.oauth.approveAuthorization(authorizationId)
        : await db.auth.oauth.denyAuthorization(authorizationId);
      if (result.error) throw new Error(result.error.message);
      const redirect = result.data?.redirect_url;
      if (!redirect) throw new Error('Supabase did not return a redirect URL.');
      window.location.assign(redirect);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  const scopes = details?.scope.split(/\s+/).filter(Boolean) ?? [];

  return (
    <div className="consent-page">
      <div className="consent-card">
        <div className="consent-brand">
          <span className="brand-mark"><Icon name="bolt" size={13} /></span>
          <span>Dexter Write</span>
        </div>

        <h1>Authorize a writing client</h1>
        <p className="muted small">
          An MCP client is asking to read and stage edits in your Dexter Write projects.
          It cannot accept its own edits; you still review every change in the editor.
        </p>

        {loading && <p className="consent-status">Checking the authorization request…</p>}
        {error && <div className="cloud-warning">{error}</div>}

        {!loading && !error && !account && (
          <div className="consent-block">
            <p className="small">Sign in with GitHub to see which client is requesting access.</p>
            <button className="btn primary" onClick={handleSignIn} disabled={busy !== null}>
              <Icon name="github" size={14} />
              {busy === 'signin' ? 'Opening GitHub…' : 'Continue with GitHub'}
            </button>
          </div>
        )}

        {!loading && !error && account && !account.allowed && (
          <div className="consent-block">
            <div className="cloud-warning">
              @{account.username} is not on this Dexter Write allowlist, so the connection would fail anyway.
              Ask the owner to add your GitHub username, then retry from the client.
            </div>
          </div>
        )}

        {!loading && !error && account?.allowed && details && (
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
                <dt>Requested access</dt>
                <dd>
                  <div className="consent-scopes">
                    {(scopes.length > 0 ? scopes : ['openid', 'profile', 'email']).map((scope) => (
                      <span className="consent-scope" key={scope}>{scope}</span>
                    ))}
                  </div>
                </dd>
              </div>
            </dl>

            <p className="consent-note">
              Only approve if you started this connection from Claude, ChatGPT, or another MCP client you trust.
            </p>

            <div className="consent-actions">
              <button className="btn" onClick={() => decide('deny')} disabled={busy !== null}>
                {busy === 'deny' ? 'Denying…' : 'Deny'}
              </button>
              <button className="btn primary" onClick={() => decide('approve')} disabled={busy !== null}>
                {busy === 'approve' ? 'Approving…' : 'Approve connection'}
              </button>
            </div>
          </>
        )}

        <a className="consent-back" href="./">Back to Dexter Write</a>
      </div>
    </div>
  );
}
