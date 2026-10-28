import { useState } from 'react';
import {
  connectServer,
  dropEndpointCache,
  newServerId,
  setStoredPermission,
  type ExternalMcpServer,
  type McpTransport,
} from '../lib/externalMcp';
import type { BridgeStatus } from '../lib/mcp/bridgeClient';
import { toast } from '../lib/toast';
import ModalHeader from './ModalHeader';

interface Props {
  servers: ExternalMcpServer[];
  setServers: (s: ExternalMcpServer[]) => void;
  bridgeEnabled: boolean;
  bridgeStatus: BridgeStatus;
  onToggleBridge: () => void;
  onClose: () => void;
}

const PRESETS: Array<{ label: string; name: string; url: string; transport: McpTransport; hint?: string }> = [
  {
    label: 'GitHub MCP',
    name: 'GitHub MCP',
    url: 'https://api.githubcopilot.com/mcp/',
    transport: 'http',
  },
  {
    label: 'Brave Search',
    name: 'Brave Search MCP',
    url: '',
    transport: 'sse',
    hint: 'Paste your Brave Search MCP server URL, then click Add.',
  },
  {
    label: 'arXiv',
    name: 'arXiv MCP',
    url: '',
    transport: 'sse',
    hint: 'Paste your arXiv MCP server URL, then click Add.',
  },
];

function copyText(text: string, label: string) {
  if (!navigator.clipboard) {
    toast('Clipboard is not available in this browser.', 'error', 3500);
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => toast(`${label} copied.`, 'success', 2600),
    () => toast('Could not access the clipboard.', 'error', 3500),
  );
}

function dotClass(status: BridgeStatus): string {
  if (status === 'live') return 'connected';
  if (status === 'offline') return 'error';
  return status === 'connecting' ? 'connecting' : '';
}

/** Phase 2: External MCP Server Manager (register / connect / permissions). */
export default function McpManager({
  servers,
  setServers,
  bridgeEnabled,
  bridgeStatus,
  onToggleBridge,
  onClose,
}: Props) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<McpTransport>('http');
  const [busy, setBusy] = useState<string | null>(null);
  const [projectDir, setProjectDir] = useState('');
  const folder = typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent)
    ? 'C:\\code\\dexter-write'
    : '/path/to/dexter-write';
  const cleanFolder = projectDir.trim().replace(/[\\/]+$/, '');
  const scriptPath = `${cleanFolder || `<project-folder>`}/bin/dexter-mcp.mjs`;
  const bridgeConfig = JSON.stringify({
    mcpServers: {
      'dexter-write': { command: 'node', args: [scriptPath] },
    },
  }, null, 2);
  const tunnelCommand = `tunnel-client init --sample sample_mcp_stdio_local --profile dexter-write --tunnel-id tunnel_YOUR_ID --mcp-command 'node "${scriptPath}"'`;

  function copyBridgeConfig() {
    if (!cleanFolder) {
      toast('Enter the Dexter Write project folder first.', 'info', 3500);
      return;
    }
    copyText(bridgeConfig, 'Claude Desktop config');
  }

  function copyTunnelCommand() {
    if (!cleanFolder) {
      toast('Enter the Dexter Write project folder first.', 'info', 3500);
      return;
    }
    copyText(tunnelCommand, 'ChatGPT tunnel command');
  }

  function update(id: string, patch: Partial<ExternalMcpServer>) {
    setServers(servers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function add() {
    const u = url.trim();
    if (!u) {
      toast('Enter an MCP server URL first.', 'info', 3200);
      return;
    }
    let host = 'MCP Server';
    try { host = new URL(u).hostname; } catch { /* keep default */ }
    const srv: ExternalMcpServer = {
      id: newServerId(),
      name: name.trim() || host,
      url: u,
      transport,
      enabled: true,
      status: 'disconnected',
      tools: [],
    };
    setServers([...servers, srv]);
    setName('');
    setUrl('');
  }

  async function connect(id: string) {
    const srv = servers.find((s) => s.id === id);
    if (!srv) return;
    dropEndpointCache(id);
    setBusy(id);
    update(id, { status: 'connecting', lastError: undefined });
    try {
      const { tools } = await connectServer({ ...srv, status: 'connecting' });
      const prev = servers.find((s) => s.id === id);
      const merged = tools.map((t) => {
        const old = prev?.tools.find((o) => o.name === t.name);
        return old ? { ...t, enabled: old.enabled } : t;
      });
      update(id, { status: 'connected', tools: merged, lastError: undefined });
    } catch (e) {
      update(id, { status: 'error', lastError: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  function remove(id: string) {
    dropEndpointCache(id);
    setServers(servers.filter((s) => s.id !== id));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="MCP server manager">
        <ModalHeader
          icon="plug"
          title="MCP Connections"
          category="AI Tools"
          sub="Connect remote MCP servers over Streamable HTTP or legacy SSE. The AI can call enabled tools — each call asks permission first unless set to always-allow."
          onClose={onClose}
        />
        <div className="modal-body">
          <div className="mcp-server" style={{ marginBottom: 14 }}>
            <div className="mcp-head">
              <strong>Dexter Write bridge (inbound)</strong>
              <span className={`dot ${dotClass(bridgeStatus)}`}>{bridgeStatus}</span>
              <span className="spacer" />
              <button className={`btn xs ${bridgeEnabled ? '' : 'primary'}`} onClick={onToggleBridge}>
                {bridgeEnabled ? 'Disable bridge' : 'Enable bridge'}
              </button>
            </div>
            <p className="muted small" style={{ margin: '7px 0' }}>
              Let MCP clients such as Claude Desktop, Cursor, or ChatGPT web read this tab and stage edits.
              Nothing is applied until you review and accept it in Dexter Write.
            </p>
            <div className="mcp-add" style={{ margin: '8px 0' }}>
              <input
                value={projectDir}
                onChange={(e) => setProjectDir(e.target.value)}
                placeholder={`Project folder, e.g. ${folder}`}
                aria-label="Dexter Write project folder"
                style={{ flex: '2 1 260px' }}
              />
              <button className="btn xs" onClick={() => copyText('npm run mcp', 'Start command')}>
                Copy start command
              </button>
              <button className="btn xs" onClick={copyBridgeConfig}>
                Copy Claude Desktop config
              </button>
              <button className="btn xs" onClick={copyTunnelCommand}>
                Copy ChatGPT tunnel command
              </button>
            </div>
            <details className="muted small">
              <summary>Bridge setup steps</summary>
              <ol style={{ margin: '8px 0 0 18px', lineHeight: 1.6 }}>
                <li>Keep this bridge enabled and run <code>npm run mcp</code> in the project folder.</li>
                <li>
                  Paste the copied JSON into Claude Desktop&apos;s config (Settings → Developer → Edit Config),
                  or the same <code>mcpServers</code> shape in Cursor&apos;s MCP settings.
                </li>
                <li>
                  Prefer the exact path? Run <code>npm run mcp:config</code> to print a ready config.
                  Use <code>npm run mcp:self-test</code> to check the daemon.
                </li>
                <li>
                  The daemon listens on <code>127.0.0.1:3088</code> only. Use <code>--reset-token</code> if the
                  app was cleared or you need to re-pair.
                </li>
              </ol>
            </details>
            <details className="muted small" style={{ marginTop: 8 }}>
              <summary>ChatGPT web setup (Secure MCP Tunnel)</summary>
              <p style={{ margin: '8px 0 0', lineHeight: 1.6 }}>
                ChatGPT web can use this bridge through OpenAI&apos;s Secure MCP Tunnel, without exposing
                port 3088 to the internet. Create a tunnel and runtime API key in{' '}
                <a
                  href="https://platform.openai.com/settings/organization/tunnels"
                  target="_blank"
                  rel="noreferrer"
                >
                  Platform tunnel settings
                </a>
                , install{' '}
                <a
                  href="https://github.com/openai/tunnel-client/releases/latest"
                  target="_blank"
                  rel="noreferrer"
                >
                  tunnel-client
                </a>
                , then run the copied init command.
              </p>
              <ol style={{ margin: '8px 0 0 18px', lineHeight: 1.6 }}>
                <li>Set <code>CONTROL_PLANE_API_KEY</code> in your shell; never paste it into chat.</li>
                <li>
                  Run <code>tunnel-client doctor --profile dexter-write --explain</code>, then{' '}
                  <code>tunnel-client run --profile dexter-write</code>. This starts the daemon, so stop
                  any separate <code>npm run mcp</code> first.
                </li>
                <li>
                  At <code>chatgpt.com/plugins</code>, add a custom MCP server, choose{' '}
                  <code>Connection: Tunnel</code>, select the tunnel, and use{' '}
                  <code>No authentication</code>. Create and install the plugin.
                </li>
                <li>Keep Dexter Write open with this bridge enabled, then mention the plugin with <code>@</code>.</li>
                <li>Run <code>npm run mcp:tunnel</code> to print the full setup with the exact local path.</li>
              </ol>
              <p style={{ margin: '8px 0 0', lineHeight: 1.6 }}>
                Custom MCP servers in ChatGPT depend on your plan, workspace, and permissions. Tunnel
                requests are outbound-only, and every edit is still staged for your review.
              </p>
            </details>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 0' }}>
            <span className="muted small">Quick presets:</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="btn xs"
                onClick={() => {
                  setName(preset.name);
                  setUrl(preset.url);
                  setTransport(preset.transport);
                  if (preset.hint) toast(preset.hint, 'info', 4200);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="mcp-add">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. GitHub MCP)" aria-label="Server name" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/mcp  or  https://…/sse" aria-label="Server URL" />
          <select value={transport} onChange={(e) => setTransport(e.target.value as McpTransport)} aria-label="Transport">
            <option value="http">HTTP</option>
            <option value="sse">SSE</option>
          </select>
          <button className="btn primary" onClick={add}>Add</button>
        </div>
        <div className="mcp-list">
          {servers.length === 0 && <div className="mcp-empty muted">No servers yet. Add one above — try a GitHub or web-search MCP endpoint.</div>}
          {servers.map((s) => (
            <div key={s.id} className="mcp-server">
              <div className="mcp-head">
                <label className="switch">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => update(s.id, { enabled: e.target.checked })} />
                </label>
                <strong>{s.name}</strong>
                <span className={`dot ${s.status}`}>{s.status}</span>
                <span className="muted small mcp-url">{s.transport.toUpperCase()} · {s.url}</span>
                <span className="spacer" />
                <button className="btn xs" disabled={busy === s.id} onClick={() => connect(s.id)}>
                  {busy === s.id ? 'Connecting…' : s.status === 'connected' ? 'Refresh' : 'Connect'}
                </button>
                <button className="btn xs danger" onClick={() => remove(s.id)}>Remove</button>
              </div>
              {s.lastError && <div className="mcp-error">❌ {s.lastError}</div>}
              {s.tools.length > 0 && (
                <div className="mcp-tools">
                  {s.tools.map((t) => (
                    <div key={t.name} className="mcp-tool">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={t.enabled}
                          onChange={(e) => update(s.id, { tools: s.tools.map((x) => (x.name === t.name ? { ...x, enabled: e.target.checked } : x)) })}
                        />
                      </label>
                      <code>{t.name}</code>
                      <span className="muted small tool-desc" title={t.description}>{(t.description || '').slice(0, 120)}</span>
                      <span className="spacer" />
                      <button
                        className="btn xs ghost"
                        title="Always allow this tool without prompting"
                        onClick={() => { setStoredPermission(s.id, t.name, 'allow-always'); }}
                      >
                        Always allow
                      </button>
                      <button
                        className="btn xs ghost"
                        title="Reset permission to prompt every time"
                        onClick={() => { setStoredPermission(s.id, t.name, null); }}
                      >
                        Prompt
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          </div>
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
