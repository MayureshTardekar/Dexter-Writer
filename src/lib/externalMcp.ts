// Phase 2 Tier 2: External MCP client (MCP_SPEC.md §3).
// Speaks JSON-RPC 2.0 (initialize / tools/list / tools/call) over:
//  - Streamable HTTP: plain POST, tolerating `text/event-stream` replies.
//  - Legacy SSE: GET the /sse endpoint to discover the POST endpoint, then POST.

export type McpTransport = 'http' | 'sse';
export type McpConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ExternalMcpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  enabled: boolean;
}

export interface ExternalMcpServer {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
  enabled: boolean;
  status: McpConnStatus;
  tools: ExternalMcpTool[];
  lastError?: string;
}

const LS_SERVERS = 'dexter-write:mcp-servers';
const LS_PERMS = 'dexter-write:mcp-perms';

export function newServerId(): string {
  return `srv_${Math.random().toString(36).slice(2, 9)}`;
}

export function loadServers(): ExternalMcpServer[] {
  try {
    const raw = localStorage.getItem(LS_SERVERS);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ExternalMcpServer[];
    return Array.isArray(arr) ? arr.map((s) => ({ ...s, status: 'disconnected' as McpConnStatus })) : [];
  } catch {
    return [];
  }
}

export function saveServers(servers: ExternalMcpServer[]): void {
  try {
    localStorage.setItem(LS_SERVERS, JSON.stringify(servers.map((s) => ({ ...s, status: 'disconnected', lastError: undefined }))));
  } catch { /* quota — ignore */ }
}

// ---------- permissions ----------

export type StoredPerm = 'allow-always' | 'deny';

export function permKey(serverId: string, tool: string): string {
  return `${serverId}:${tool}`;
}

export function getStoredPermission(serverId: string, tool: string): StoredPerm | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(LS_PERMS) || '{}') as Record<string, StoredPerm>;
    return all[permKey(serverId, tool)];
  } catch {
    return undefined;
  }
}

export function setStoredPermission(serverId: string, tool: string, v: StoredPerm | null): void {
  try {
    const all = JSON.parse(localStorage.getItem(LS_PERMS) || '{}') as Record<string, StoredPerm>;
    if (v) all[permKey(serverId, tool)] = v;
    else delete all[permKey(serverId, tool)];
    localStorage.setItem(LS_PERMS, JSON.stringify(all));
  } catch { /* ignore */ }
}

// ---------- JSON-RPC transport ----------

let rpcId = 1;

interface RpcEnvelope {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function parseSseFrames(text: string): string[] {
  const payloads: string[] = [];
  const events = text.split(/\r?\n\r?\n/);
  for (const ev of events) {
    const dataLines = ev.split(/\r?\n/).filter((l) => l.startsWith('data:'));
    if (dataLines.length === 0) continue;
    const data = dataLines.map((l) => l.slice(5).trim()).join('\n');
    if (data && data !== '[DONE]') payloads.push(data);
  }
  return payloads;
}

async function rpcPost(endpoint: string, method: string, params?: unknown): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params: params ?? {} });
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body,
    });
  } catch (e) {
    throw new Error(`Network error: ${e instanceof Error ? e.message : String(e)}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    const frames = parseSseFrames(text);
    for (const f of frames) {
      try {
        const env = JSON.parse(f) as RpcEnvelope;
        if (env.error) throw new Error(`MCP error ${env.error.code}: ${env.error.message}`);
        if (env.result !== undefined) return env.result;
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
    throw new Error('SSE stream contained no JSON-RPC result.');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const env = (await res.json()) as RpcEnvelope;
  if (env.error) throw new Error(`MCP error ${env.error.code}: ${env.error.message}`);
  return env.result;
}

async function discoverSseEndpoint(sseUrl: string, timeoutMs = 12000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(sseUrl, { headers: { Accept: 'text/event-stream' }, signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`SSE GET failed with HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split(/\r?\n\r?\n/);
      buf = events.pop() ?? '';
      for (const ev of events) {
        const lines = ev.split(/\r?\n/);
        const eventName = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
        const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
        if (eventName === 'endpoint' && data) {
          try { await reader.cancel(); } catch { /* noop */ }
          return new URL(data, sseUrl).toString();
        }
      }
    }
    throw new Error('SSE stream ended without an `endpoint` event.');
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('Timed out waiting for SSE endpoint event.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const endpointCache = new Map<string, string>();

export async function resolveEndpoint(server: ExternalMcpServer): Promise<string> {
  const hit = endpointCache.get(server.id);
  if (hit) return hit;
  const endpoint = server.transport === 'sse' ? await discoverSseEndpoint(server.url) : server.url;
  endpointCache.set(server.id, endpoint);
  return endpoint;
}

export function dropEndpointCache(serverId: string): void {
  endpointCache.delete(serverId);
}

// ---------- high-level ops ----------

export interface ConnectResult {
  tools: ExternalMcpTool[];
}

export async function connectServer(server: ExternalMcpServer): Promise<ConnectResult> {
  const endpoint = await resolveEndpoint(server);
  await rpcPost(endpoint, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'dexter-write', version: '1.0.0' },
  });
  // Best-effort initialized notification (servers must tolerate its absence).
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
  } catch { /* noop */ }
  const list = (await rpcPost(endpoint, 'tools/list', {})) as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
  const tools: ExternalMcpTool[] = (list.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    serverId: server.id,
    enabled: true,
  }));
  return { tools };
}

export function mcpContentToText(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text?: string }> } | null;
  if (!r) return '(empty result)';
  if (Array.isArray(r.content)) {
    const parts = r.content.map((c) => (c.type === 'text' ? c.text ?? '' : `[${c.type}]`)).filter(Boolean);
    if (parts.length > 0) return parts.join('\n');
  }
  try {
    return JSON.stringify(r).slice(0, 4000);
  } catch {
    return String(r).slice(0, 4000);
  }
}

export async function callExternalTool(server: ExternalMcpServer, toolName: string, args: Record<string, unknown>): Promise<string> {
  const endpoint = await resolveEndpoint(server);
  const result = await rpcPost(endpoint, 'tools/call', { name: toolName, arguments: args });
  return mcpContentToText(result);
}

// ---------- LLM plumbing ----------

export function sanitizeName(s: string): string {
  return (s || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'tool';
}

/** Provider-safe function name namespaced by server. */
export function externalDefName(server: ExternalMcpServer, tool: ExternalMcpTool): string {
  return `mcp_${sanitizeName(server.name)}_${sanitizeName(tool.name)}`.slice(0, 64);
}

export interface LlmExternalDef {
  defName: string;
  serverId: string;
  toolName: string;
  description: string;
  parameters: Record<string, unknown>;
}

export function enabledExternalDefs(servers: ExternalMcpServer[]): LlmExternalDef[] {
  const out: LlmExternalDef[] = [];
  for (const s of servers) {
    if (!s.enabled || s.status !== 'connected') continue;
    for (const t of s.tools) {
      if (!t.enabled) continue;
      out.push({
        defName: externalDefName(s, t),
        serverId: s.id,
        toolName: t.name,
        description: t.description ? `[${s.name}] ${t.description}`.slice(0, 500) : `External MCP tool ${t.name} on ${s.name}`,
        parameters: t.inputSchema,
      });
    }
  }
  return out.slice(0, 24);
}
