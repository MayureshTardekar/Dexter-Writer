import { getDocumentOutline } from '../docUtils';
import type { DocMode } from '../templates';

export const BRIDGE_DEFAULT_URL = 'http://127.0.0.1:3088';
export const BRIDGE_TOKEN_KEY = 'dexter-write:mcp-bridge-token';
const MAX_READ_CHARS = 20_000;

export type BridgeStatus = 'off' | 'connecting' | 'live' | 'offline';

export interface BridgeDocument {
  name: string;
  mode: DocMode;
  content: string;
}

export interface BridgeFileSummary {
  name: string;
  mode: DocMode;
  lines: number;
  active: boolean;
}

export interface BridgeMutationOutcome {
  ok: boolean;
  message: string;
  files?: number;
  file?: string;
}

export interface BridgeCompileOutcome {
  ok: boolean;
  file: string;
  mode: DocMode;
  message: string;
  diagnostics: string[];
  pages?: number;
  compileMs?: number;
}

export interface BridgeDiagnosticsIssue {
  file: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface BridgeDiagnosticsOutcome {
  issues: BridgeDiagnosticsIssue[];
  compile?: BridgeCompileOutcome | null;
}

export interface BridgeAccess {
  active: () => BridgeDocument;
  files: () => BridgeFileSummary[];
  readFile?: (args: Record<string, unknown>) => BridgeDocument | null;
  stageEdit?: (args: Record<string, unknown>) => BridgeMutationOutcome | Promise<BridgeMutationOutcome>;
  insertContent?: (args: Record<string, unknown>) => BridgeMutationOutcome | Promise<BridgeMutationOutcome>;
  compile?: (args: Record<string, unknown>) => BridgeCompileOutcome | Promise<BridgeCompileOutcome>;
  diagnostics?: (args: Record<string, unknown>) => BridgeDiagnosticsOutcome | Promise<BridgeDiagnosticsOutcome>;
}

export interface McpTextResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface BridgeTokenStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export type BridgeRequest =
  | {
      id: string;
      method: 'tool_call';
      params: { name: string; arguments?: Record<string, unknown> };
    }
  | {
      id: string;
      method: 'resource_read';
      params: { uri: string };
    };

export interface BridgeResponse {
  id: string;
  ok: boolean;
  result?: McpTextResult;
  error?: string;
}

function randomToken(): string {
  const cryptoApi = typeof crypto !== 'undefined' ? crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = new Uint8Array(24);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
  else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

let fallbackToken = '';

export function ensureBridgeToken(store?: BridgeTokenStore | null): string {
  const target = store === undefined
    ? (typeof localStorage !== 'undefined' ? localStorage : null)
    : store;
  if (target) {
    try {
      const existing = target.getItem(BRIDGE_TOKEN_KEY);
      if (existing) return existing;
      const created = randomToken();
      target.setItem(BRIDGE_TOKEN_KEY, created);
      return created;
    } catch {
      if (fallbackToken) return fallbackToken;
      fallbackToken = randomToken();
      return fallbackToken;
    }
  }
  if (!fallbackToken) fallbackToken = randomToken();
  return fallbackToken;
}

export function defaultBridgeUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_DEXTER_MCP_BRIDGE_URL || BRIDGE_DEFAULT_URL;
}

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value.trim() || NaN);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(1, Math.floor(parsed));
}

export function formatReadActive(
  doc: BridgeDocument,
  args: Record<string, unknown> = {},
): string {
  const lines = doc.content.split('\n');
  const total = Math.max(1, lines.length);
  const start = Math.min(positiveInt(args.start_line) ?? 1, total);
  const end = Math.min(Math.max(positiveInt(args.end_line) ?? total, start), total);
  const numbered = args.include_line_numbers !== false;
  const width = String(end).length;
  const body = lines
    .slice(start - 1, end)
    .map((line, index) => (numbered ? `${String(start + index).padStart(width)} | ${line}` : line))
    .join('\n');
  const range = start === 1 && end === total ? `${total} lines` : `lines ${start}-${end} of ${total}`;
  const clipped = body.length > MAX_READ_CHARS;
  const text = clipped ? `${body.slice(0, MAX_READ_CHARS)}\n… [truncated]` : body;
  return `${doc.name} (${doc.mode}, ${range})\n${text}`;
}

export function formatOutline(doc: BridgeDocument): string {
  const items = getDocumentOutline(doc.content, doc.mode);
  const heading = `Outline of "${doc.name}" (${doc.mode}, ${items.length} heading${items.length === 1 ? '' : 's'})`;
  if (items.length === 0) return `${heading}\nNo headings found.`;
  const body = items
    .map((item) => `${'  '.repeat(Math.max(0, item.level - 1))}- ${item.title} (line ${item.line})`)
    .join('\n');
  return `${heading}\n${body}`;
}

export function formatProjectFiles(files: BridgeFileSummary[]): string {
  const active = files.find((file) => file.active);
  const heading = `Project files (${files.length}${active ? `, active: ${active.name}` : ''})`;
  if (files.length === 0) return `${heading}\nNo files in this project.`;
  const body = files
    .map((file) => `- ${file.name} [${file.mode}, ${file.lines} lines]${file.active ? ' (active)' : ''}`)
    .join('\n');
  return `${heading}\n${body}`;
}

export function formatDiagnostics(outcome: BridgeDiagnosticsOutcome): string {
  const { issues, compile } = outcome;
  const lines = [
    `Project diagnostics (${issues.length} issue${issues.length === 1 ? '' : 's'})`,
  ];
  if (issues.length === 0) {
    lines.push('No validation issues found.');
  } else {
    for (const issue of issues) {
      lines.push(`- [${issue.severity}] ${issue.file}: ${issue.message}`);
    }
  }
  if (compile) {
    const details: string[] = [];
    if (typeof compile.pages === 'number') details.push(`${compile.pages} pages`);
    if (typeof compile.compileMs === 'number') details.push(`${compile.compileMs}ms`);
    const suffix = details.length ? ` (${details.join(', ')})` : '';
    lines.push(
      '',
      `Last compile: ${compile.file} ${compile.ok ? 'succeeded' : 'failed'}${suffix}`,
      compile.message,
    );
    for (const diagnostic of compile.diagnostics) lines.push(`- ${diagnostic}`);
  }
  return lines.join('\n');
}

function textResult(text: string): McpTextResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(text: string): McpTextResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function mutationResult(outcome: BridgeMutationOutcome): McpTextResult {
  if (!outcome.ok) return errorResult(outcome.message);
  const suffix = outcome.files
    ? `\n${outcome.files} file${outcome.files === 1 ? '' : 's'} changed in Dexter Write. Undo is available.`
    : '';
  return textResult(`${outcome.message}${suffix}`);
}

export async function executeBridgeTool(
  access: BridgeAccess,
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpTextResult> {
  try {
    switch (name) {
      case 'dexter_read_active_document':
        return textResult(formatReadActive(access.active(), args));
      case 'dexter_get_outline':
        return textResult(formatOutline(access.active()));
      case 'dexter_list_project_files':
        return textResult(formatProjectFiles(access.files()));
      case 'dexter_read_project_file': {
        if (!access.readFile) return errorResult('Project file reads are not available in this build.');
        const doc = access.readFile(args);
        if (!doc) return errorResult('Dexter Write could not find that project file.');
        return textResult(formatReadActive(doc, args));
      }
      case 'dexter_stage_edit': {
        if (!access.stageEdit) return errorResult('External edits are not available in this build.');
        return mutationResult(await access.stageEdit(args));
      }
      case 'dexter_insert_content': {
        if (!access.insertContent) return errorResult('External edits are not available in this build.');
        return mutationResult(await access.insertContent(args));
      }
      case 'dexter_compile_document': {
        if (!access.compile) return errorResult('Compilation is not available in this build.');
        const result = await access.compile(args);
        return result.ok ? textResult(result.message) : errorResult(result.message);
      }
      case 'dexter_get_diagnostics': {
        if (!access.diagnostics) return errorResult('Diagnostics are not available in this build.');
        return textResult(formatDiagnostics(await access.diagnostics(args)));
      }
      default:
        return errorResult(`Unknown Dexter Write tool: ${name}`);
    }
  } catch (error) {
    return errorResult(
      `Dexter Write could not answer: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export const BRIDGE_RESOURCES = [
  'dexter://document/active',
  'dexter://document/outline',
  'dexter://project/files',
  'dexter://compiler/diagnostics',
] as const;

export async function executeBridgeResource(
  access: BridgeAccess,
  uri: string,
): Promise<McpTextResult> {
  try {
    switch (uri) {
      case 'dexter://document/active':
        return textResult(formatReadActive(access.active()));
      case 'dexter://document/outline':
        return textResult(formatOutline(access.active()));
      case 'dexter://project/files':
        return textResult(formatProjectFiles(access.files()));
      case 'dexter://compiler/diagnostics':
        if (!access.diagnostics) return errorResult('Diagnostics are not available in this build.');
        return textResult(formatDiagnostics(await access.diagnostics({})));
      default:
        return errorResult(`Unknown Dexter Write resource: ${uri}`);
    }
  } catch (error) {
    return errorResult(
      `Dexter Write could not read the resource: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function parseBridgeRequest(raw: string): BridgeRequest | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || !record.params || typeof record.params !== 'object') {
      return null;
    }
    if (Array.isArray(record.params)) return null;
    const params = record.params as Record<string, unknown>;
    if (record.method === 'tool_call') {
      if (typeof params.name !== 'string') return null;
      if (params.arguments !== undefined
        && (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments))) {
        return null;
      }
      return {
        id: record.id,
        method: 'tool_call',
        params: {
          name: params.name,
          arguments: params.arguments as Record<string, unknown> | undefined,
        },
      };
    }
    if (record.method === 'resource_read') {
      if (typeof params.uri !== 'string' || !params.uri) return null;
      return { id: record.id, method: 'resource_read', params: { uri: params.uri } };
    }
    return null;
  } catch {
    return null;
  }
}

export interface McpBridgeClientOptions {
  baseUrl?: string;
  tokenStore?: BridgeTokenStore | null;
  onStatus?: (status: BridgeStatus) => void;
}

export class McpBridgeClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly onStatus?: (status: BridgeStatus) => void;
  private source: EventSource | null = null;
  private access: BridgeAccess | null = null;
  private stopped = true;
  private status: BridgeStatus = 'off';

  constructor(options: McpBridgeClientOptions = {}) {
    this.baseUrl = options.baseUrl || defaultBridgeUrl();
    this.token = ensureBridgeToken(options.tokenStore);
    this.onStatus = options.onStatus;
  }

  private emit(status: BridgeStatus) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  private connect() {
    if (typeof EventSource === 'undefined') {
      this.emit('offline');
      return;
    }
    this.emit('connecting');
    let source: EventSource;
    try {
      const url = new URL('/events', this.baseUrl);
      url.searchParams.set('token', this.token);
      source = new EventSource(url.toString());
    } catch {
      this.emit('offline');
      return;
    }
    this.source = source;
    source.addEventListener('open', () => {
      if (!this.stopped && this.source === source) this.emit('live');
    });
    source.addEventListener('error', () => {
      if (!this.stopped && this.source === source) this.emit('offline');
    });
    source.addEventListener('request', (event) => {
      if (this.stopped || this.source !== source) return;
      const message = event as MessageEvent<string>;
      void this.handleMessage(message.data);
    });
  }

  private async post(body: BridgeResponse): Promise<void> {
    try {
      const url = new URL('/response', this.baseUrl);
      url.searchParams.set('token', this.token);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) this.emit('offline');
    } catch {
      this.emit('offline');
    }
  }

  private async handleMessage(raw: string): Promise<void> {
    const request = parseBridgeRequest(raw);
    if (!request) return;
    const access = this.access;
    if (!access) {
      await this.post({ id: request.id, ok: false, error: 'Dexter Write bridge is disabled.' });
      return;
    }
    const result = request.method === 'resource_read'
      ? await executeBridgeResource(access, request.params.uri)
      : await executeBridgeTool(access, request.params.name, request.params.arguments);
    await this.post({ id: request.id, ok: true, result });
  }

  start(access: BridgeAccess) {
    this.stop();
    this.access = access;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.access = null;
    this.source?.close();
    this.source = null;
    this.emit('off');
  }

  getStatus(): BridgeStatus {
    return this.status;
  }
}
