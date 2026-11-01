import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchBridgeHealth,
  fetchBridgeSetup,
  startLocalBridgeDaemon,
  type BridgeHealth,
  type BridgeSetup,
  type BridgeStatus,
} from '../lib/mcp/bridgeClient';
import { toast } from '../lib/toast';

type ClientKey = 'antigravity' | 'claude' | 'cursor' | 'other';

interface Props {
  bridgeEnabled: boolean;
  bridgeStatus: BridgeStatus;
  onToggleBridge: () => void;
}

const CLIENTS: Array<{ key: ClientKey; label: string }> = [
  { key: 'antigravity', label: 'Antigravity' },
  { key: 'claude', label: 'Claude Desktop' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'other', label: 'Other' },
];

const INSTRUCTIONS: Record<ClientKey, string[]> = {
  antigravity: [
    'Open Antigravity → MCP Servers → Manage MCP Servers → View raw config.',
    'Paste the copied block under mcpServers. For a workspace-only setup, save it as .agents/mcp_config.json.',
    'Restart Antigravity or reconnect the MCP server.',
  ],
  claude: [
    'Open Claude Desktop → Settings → Developer → Edit Config.',
    'Paste the copied block under mcpServers, then save the file.',
    'Quit and reopen Claude Desktop. Ask it to list the Dexter Write tools.',
  ],
  cursor: [
    'Open Cursor → Settings → MCP.',
    'Add a new stdio server using the copied command, arguments, and working directory.',
    'Reload the MCP connection after saving.',
  ],
  other: [
    'Open your MCP client’s local stdio server configuration.',
    'Paste the copied mcpServers block and save.',
    'Restart the client or reload its MCP connection.',
  ],
};

function statusLabel(health: BridgeHealth | null, setup: BridgeSetup | null, bridgeStatus: BridgeStatus): string {
  if (setup) return 'connected';
  if (health?.daemon) return 'daemon ready';
  if (bridgeStatus === 'live') return 'connecting';
  if (bridgeStatus === 'offline') return 'offline';
  return bridgeStatus;
}

function statusDot(health: BridgeHealth | null, setup: BridgeSetup | null): string {
  if (setup) return 'connected';
  if (health?.daemon) return 'connecting';
  return 'error';
}

export default function McpConnectWizard({ bridgeEnabled, bridgeStatus, onToggleBridge }: Props) {
  const [setup, setSetup] = useState<BridgeSetup | null>(null);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [client, setClient] = useState<ClientKey>('antigravity');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const hosted = !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  const refresh = useCallback(async () => {
    const nextHealth = await fetchBridgeHealth();
    setHealth(nextHealth);
    if (!nextHealth?.daemon) {
      setSetup(null);
      return;
    }
    const nextSetup = await fetchBridgeSetup();
    setSetup(nextSetup);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 8_000);
    return () => window.clearInterval(timer);
  }, [refresh, bridgeStatus]);

  const configKey = client === 'other' ? 'generic' : client;
  const configText = useMemo(
    () => (setup ? JSON.stringify(setup.configs[configKey], null, 2) : ''),
    [setup, configKey],
  );

  async function startBridge() {
    setStarting(true);
    setError('');
    const result = await startLocalBridgeDaemon();
    if (!result.ok) {
      setError(result.error || 'Could not start the shared bridge.');
      setStarting(false);
      return;
    }
    if (!bridgeEnabled) onToggleBridge();
    setHealth(result.health ?? await fetchBridgeHealth());
    setSetup(await fetchBridgeSetup());
    setStarting(false);
    toast('Shared bridge is running. Now add a client config.', 'success', 4000);
  }

  async function copyConfig() {
    if (!configText) return;
    try {
      await navigator.clipboard.writeText(configText);
      setCopied(client);
      window.setTimeout(() => setCopied(''), 2500);
      toast(`${CLIENTS.find((item) => item.key === client)?.label} config copied.`, 'success', 2600);
    } catch {
      toast('Could not access the clipboard.', 'error', 3500);
    }
  }

  async function testConnection() {
    await refresh();
    const nextHealth = await fetchBridgeHealth();
    if (nextHealth?.daemon && nextHealth.rpc) {
      toast(
        nextHealth.paired
          ? `Bridge reachable. ${nextHealth.clients ?? 0} Dexter tab${nextHealth.clients === 1 ? '' : 's'} connected.`
          : 'Bridge reachable. Enable the browser bridge so agents can see this tab.',
        nextHealth.paired ? 'success' : 'info',
        4200,
      );
    } else {
      toast('Bridge is not reachable. Start it again or run npm run mcp:daemon.', 'error', 4500);
    }
  }

  return (
    <div className="mcp-wizard">
      <div className="mcp-head">
        <strong>Connect an AI writer</strong>
        <span className={`dot ${statusDot(health, setup)}`}>{statusLabel(health, setup, bridgeStatus)}</span>
        <span className="spacer" />
        <button className={`btn xs ${bridgeEnabled ? '' : 'primary'}`} onClick={onToggleBridge}>
          {bridgeEnabled ? 'Disable browser bridge' : 'Enable browser bridge'}
        </button>
      </div>
      <p className="muted small mcp-wizard-intro">
        One shared local bridge serves every AI client. Antigravity, Claude Desktop, Cursor, and others can stay
        connected at the same time; closing one client does not stop the bridge.
      </p>

      {!setup ? (
        <div className="mcp-wizard-start">
          <div className="mcp-wizard-state">
            <strong>
              {health?.daemon
                ? 'Daemon ready, waiting for this tab'
                : hosted
                  ? 'Bridge is not running on this computer'
                  : 'Local bridge is not running'}
            </strong>
            <span className="muted small">
              {health?.version
                ? `Version ${health.version}`
                : hosted
                  ? 'A hosted page cannot launch local processes. Run the bridge once on this computer, then retry.'
                  : 'Start it from here. No terminal needed in local development.'}
            </span>
          </div>
          {error && <div className="mcp-error">{error}</div>}
          <div className="mcp-add" style={{ margin: '8px 0 0' }}>
            {hosted ? (
              <button className="btn primary" onClick={() => { void testConnection(); }}>
                Retry connection
              </button>
            ) : (
              <button className="btn primary" onClick={() => { void startBridge(); }} disabled={starting}>
                {starting ? 'Starting…' : 'Start local bridge'}
              </button>
            )}
            <button className="btn xs" onClick={() => { void navigator.clipboard?.writeText('npm run mcp:daemon').then(() => toast('Command copied.', 'success', 2200), () => toast('Could not copy.', 'error', 3000)); }}>
              Copy command
            </button>
            {!bridgeEnabled && <button className="btn xs" onClick={onToggleBridge}>Enable browser bridge</button>}
            <button className="btn xs ghost" onClick={() => { void testConnection(); }}>Test connection</button>
          </div>
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            {hosted
              ? 'Easiest on Windows: double-click Start Dexter Bridge.cmd in the Dexter Write folder. Keep this tab open afterwards.'
              : 'If an AI client is already configured, just restart it. It will start the shared bridge automatically.'}
          </p>
        </div>
      ) : (
        <>
          <div className="mcp-detected">
            <span className="muted small">Detected project</span>
            <code>{setup.projectDir}</code>
            <span className="muted small">v{setup.version} · port {setup.port} · {setup.clients} tab{setup.clients === 1 ? '' : 's'}</span>
          </div>

          <div className="seg mcp-client-tabs" role="tablist" aria-label="AI client">
            {CLIENTS.map((item) => (
              <button
                key={item.key}
                role="tab"
                aria-selected={client === item.key}
                className={client === item.key ? 'active' : ''}
                onClick={() => setClient(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <pre className="cloud-code mcp-config-code">{configText}</pre>
          <div className="mcp-add" style={{ margin: '8px 0 0' }}>
            <button className="btn primary" onClick={() => { void copyConfig(); }}>
              {copied === client ? 'Copied' : `Copy ${CLIENTS.find((item) => item.key === client)?.label} config`}
            </button>
            <button className="btn xs" onClick={() => { void testConnection(); }}>Test connection</button>
            {!bridgeEnabled && <button className="btn xs" onClick={onToggleBridge}>Enable browser bridge</button>}
          </div>

          <ol className="mcp-wizard-steps">
            {INSTRUCTIONS[client].map((step) => <li key={step}>{step}</li>)}
          </ol>
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            Keep this Dexter tab open and the browser bridge enabled. Multiple AI clients can connect, but only
            the active tab is edited. Use one project tab while agents are writing.
          </p>
        </>
      )}
    </div>
  );
}
