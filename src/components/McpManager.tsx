import { useState } from 'react';
import {
  connectServer,
  dropEndpointCache,
  newServerId,
  setStoredPermission,
  type ExternalMcpServer,
  type McpTransport,
} from '../lib/externalMcp';
import ModalHeader from './ModalHeader';

interface Props {
  servers: ExternalMcpServer[];
  setServers: (s: ExternalMcpServer[]) => void;
  onClose: () => void;
}

/** Phase 2: External MCP Server Manager (register / connect / permissions). */
export default function McpManager({ servers, setServers, onClose }: Props) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<McpTransport>('http');
  const [busy, setBusy] = useState<string | null>(null);

  function update(id: string, patch: Partial<ExternalMcpServer>) {
    setServers(servers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function add() {
    const u = url.trim();
    if (!u) return;
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
          title="External MCP Servers"
          category="AI Tools"
          sub="Connect remote MCP servers over Streamable HTTP or legacy SSE. The AI can call enabled tools — each call asks permission first unless set to always-allow."
          onClose={onClose}
        />
        <div className="modal-body">
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
