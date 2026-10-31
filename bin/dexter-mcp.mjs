#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const SERVER_NAME = 'dexter-write';
const SERVER_VERSION = '1.1.0';
const HOST = '127.0.0.1';
const DEFAULT_PORT = 3088;
const REQUEST_TIMEOUT_MS = 20_000;
const COMPILE_TIMEOUT_MS = 90_000;
const MAX_BODY_BYTES = 1_000_000;
const LATEST_LEGACY_PROTOCOL = '2025-11-25';
const SUPPORTED_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', LATEST_LEGACY_PROTOCOL]);
const SERVER_INSTRUCTIONS = 'Dexter Write bridge for the user\'s open local project. Read first with dexter_list_project_files, dexter_read_active_document, or dexter_read_project_file. Change files with dexter_stage_edit or dexter_insert_content; these apply immediately and keep an undo snapshot in Dexter Write. Verify with dexter_compile_document and dexter_get_diagnostics. Never claim a change was applied or a build passed without tool evidence. Keep Dexter Write open with the bridge enabled.';
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const STAGED_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const TOOLS = [
  {
    name: 'dexter_read_active_document',
    description: 'Use this first to inspect the document currently open in Dexter Write. Use start_line/end_line to page through long documents.',
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        start_line: { type: 'integer', minimum: 1, description: 'First line to read (1-indexed). Defaults to 1.' },
        end_line: { type: 'integer', minimum: 1, description: 'Last line to read, inclusive. Defaults to the end.' },
        include_line_numbers: { type: 'boolean', description: 'Prefix each line with its number. Defaults to true.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'dexter_get_outline',
    description: 'Use this to find the headings and structure of the active Dexter Write document with line numbers.',
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dexter_list_project_files',
    description: 'Use this to discover every file in the open Dexter Write project, including format, line count, and the active file marker.',
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'dexter_read_project_file',
    description: 'Use this to read any project file by filename or file_id. Defaults to the active file; supports line ranges and line numbers.',
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Project file name, e.g. main.tex.' },
        file_id: { type: 'string', description: 'Stable Dexter Write file id.' },
        start_line: { type: 'integer', minimum: 1, description: 'First line to read (1-indexed).' },
        end_line: { type: 'integer', minimum: 1, description: 'Last line to read, inclusive.' },
        include_line_numbers: { type: 'boolean', description: 'Prefix each line with its number. Defaults to true.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'dexter_stage_edit',
    description: 'Use this when changing existing text in a project file. Applies an exact-string edit immediately in Dexter Write and keeps an undo snapshot. old_string must occur exactly once unless replace_all is true.',
    annotations: STAGED_WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        old_string: { type: 'string', description: 'Exact text to replace.' },
        new_string: { type: 'string', description: 'Replacement text.' },
        filename: { type: 'string', description: 'Target file name. Defaults to the active file.' },
        file_id: { type: 'string', description: 'Target file id. Takes precedence over filename.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring a unique match.' },
        explanation: { type: 'string', description: 'Short label shown in the Dexter Write undo history.' },
      },
      required: ['old_string', 'new_string'],
      additionalProperties: false,
    },
  },
  {
    name: 'dexter_insert_content',
    description: 'Use this when adding new text to a project file. Inserts text before or after a specific line immediately and keeps an undo snapshot.',
    annotations: STAGED_WRITE_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        target_line: { type: 'integer', minimum: 1, description: 'Line number to insert at.' },
        position: { type: 'string', enum: ['before', 'after'], description: 'Insert before or after the target line. Defaults to after.' },
        content: { type: 'string', description: 'Text to insert. May contain newlines.' },
        filename: { type: 'string', description: 'Target file name. Defaults to the active file.' },
        file_id: { type: 'string', description: 'Target file id. Takes precedence over filename.' },
        explanation: { type: 'string', description: 'Short label shown in the Dexter Write undo history.' },
      },
      required: ['target_line', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'dexter_compile_document',
    description: 'Use this after edits to compile or validate a project file with the same engines as Dexter Write preview. Markdown is validated; LaTeX and Typst compile to PDF by default.',
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Target file name. Defaults to the active file.' },
        file_id: { type: 'string', description: 'Target file id. Takes precedence over filename.' },
        format: { type: 'string', enum: ['pdf', 'preview'], description: 'PDF output or SVG preview for Typst. Defaults to pdf.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'dexter_get_diagnostics',
    description: 'Use this to check project validation issues (missing files, unsupported references, warnings) and the last compile result.',
    annotations: READ_ONLY_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Only report issues for this file.' },
        file_id: { type: 'string', description: 'Only report issues for this file id.' },
      },
      additionalProperties: false,
    },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

const RESOURCES = [
  {
    uri: 'dexter://document/active',
    name: 'Active document',
    description: 'Current active Dexter Write document with line numbers.',
    mimeType: 'text/plain',
  },
  {
    uri: 'dexter://document/outline',
    name: 'Active document outline',
    description: 'Headings in the active document with line numbers.',
    mimeType: 'text/plain',
  },
  {
    uri: 'dexter://project/files',
    name: 'Project files',
    description: 'Every file in the open project, including formats and the active marker.',
    mimeType: 'text/plain',
  },
  {
    uri: 'dexter://compiler/diagnostics',
    name: 'Compiler diagnostics',
    description: 'Project validation issues and the last compile result.',
    mimeType: 'text/plain',
  },
];

const PROMPTS = [
  {
    name: 'audit-academic-paper',
    description: 'Audit an academic paper for structure, argument gaps, citations, and LaTeX issues using the open project.',
    arguments: [
      { name: 'focus', description: 'Optional area to prioritize, e.g. methodology or citations.', required: false },
    ],
  },
  {
    name: 'tailor-resume',
    description: 'Tailor the active resume to a job description without inventing experience.',
    arguments: [
      { name: 'job_description', description: 'The target job description or key requirements.', required: true },
    ],
  },
  {
    name: 'fix-latex-errors',
    description: 'Diagnose and apply fixes for LaTeX compile or validation errors.',
    arguments: [
      { name: 'file', description: 'Optional target .tex file. Defaults to the active file.', required: false },
    ],
  },
];

function log(...args) {
  process.stderr.write(`[dexter-mcp] ${args.join(' ')}\n`);
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const prefixed = process.argv.find((value) => value.startsWith(`${flag}=`));
  return prefixed ? prefixed.slice(flag.length + 1) : '';
}

function tokenFilePath() {
  return process.env.DEXTER_MCP_TOKEN_FILE
    || path.join(os.homedir(), '.dexter-write', 'mcp-token');
}

function readTokenFile() {
  try {
    return fs.readFileSync(tokenFilePath(), 'utf8').trim();
  } catch {
    return '';
  }
}

function writeTokenFile(token) {
  try {
    const file = tokenFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (error) {
    log(`Could not persist pairing token: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function tokensMatch(expected, actual) {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function extraAllowedOrigins() {
  return (process.env.DEXTER_MCP_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function originAllowed(origin) {
  if (!origin) return false;
  if (extraAllowedOrigins().includes(origin)) return true;
  try {
    const url = new URL(origin);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    return local && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin',
  };
}

function sendJson(res, status, body, origin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(origin && originAllowed(origin) ? corsHeaders(origin) : {}),
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createBridge(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const persistToken = options.persistToken ?? true;
  let storedToken = options.token || '';
  let server = null;
  let listeningPort = port;
  let nextClientId = 1;
  let nextRequestId = 1;
  let activeClientId = null;
  const clients = new Map();
  const pending = new Map();

  function chooseClient() {
    if (activeClientId && clients.has(activeClientId)) return clients.get(activeClientId);
    const entries = [...clients.values()];
    return entries[entries.length - 1] || null;
  }

  function rejectPendingForClient(clientId, reason) {
    for (const [id, entry] of pending) {
      if (entry.clientId !== clientId) continue;
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(new Error(reason));
    }
  }

  function authorize(req, url) {
    const origin = String(req.headers.origin || '');
    const token = url.searchParams.get('token') || '';
    if (!origin || !originAllowed(origin)) {
      return { ok: false, status: 403, origin, error: 'This bridge only accepts local Dexter Write origins.' };
    }
    if (storedToken) {
      if (!tokensMatch(storedToken, token)) {
        return { ok: false, status: 401, origin, error: 'Bridge pairing token does not match.' };
      }
      return { ok: true, origin };
    }
    if (!token || token.length < 16) {
      return { ok: false, status: 401, origin, error: 'A browser-generated pairing token is required.' };
    }
    storedToken = token;
    if (persistToken) writeTokenFile(storedToken);
    log('Paired with a Dexter Write browser tab.');
    return { ok: true, origin };
  }

  function requestBrowser(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const client = chooseClient();
    if (!client) {
      return Promise.reject(new Error('Dexter Write is not open. Start `npm run dev`, open the app, and enable the MCP bridge in the status bar.'));
    }
    const id = `r${nextRequestId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Dexter Write did not answer within ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer, clientId: client.id });
      try {
        client.res.write(`event: request\ndata: ${JSON.stringify({ id, method, params })}\n\n`);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  function handleEvents(req, res, url) {
    const auth = authorize(req, url);
    if (!auth.ok) {
      sendJson(res, auth.status, { ok: false, error: auth.error }, auth.origin);
      return;
    }
    res.writeHead(200, {
      ...corsHeaders(auth.origin),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    const client = { id: `c${nextClientId++}`, res };
    clients.set(client.id, client);
    activeClientId = client.id;
    res.write(`event: hello\ndata: ${JSON.stringify({
      server: SERVER_NAME,
      version: SERVER_VERSION,
      clients: clients.size,
    })}\n\n`);
    req.on('close', () => {
      clients.delete(client.id);
      if (activeClientId === client.id) {
        const remaining = [...clients.keys()];
        activeClientId = remaining[remaining.length - 1] || null;
      }
      rejectPendingForClient(client.id, 'The Dexter Write browser tab disconnected.');
    });
  }

  async function handleResponse(req, res, url) {
    const auth = authorize(req, url);
    if (!auth.ok) {
      sendJson(res, auth.status, { ok: false, error: auth.error }, auth.origin);
      return;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : 'Invalid JSON response.',
      }, auth.origin);
      return;
    }
    if (!body || typeof body.id !== 'string') {
      sendJson(res, 400, { ok: false, error: 'Missing response id.' }, auth.origin);
      return;
    }
    const entry = pending.get(body.id);
    if (entry) {
      pending.delete(body.id);
      clearTimeout(entry.timer);
      if (body.ok === false) {
        entry.reject(new Error(typeof body.error === 'string' ? body.error : 'Dexter Write returned an error.'));
      } else {
        entry.resolve(body.result);
      }
    }
    sendJson(res, 200, { ok: true }, auth.origin);
  }

  function handleHealth(req, res) {
    const origin = String(req.headers.origin || '');
    sendJson(res, 200, {
      ok: true,
      server: SERVER_NAME,
      version: SERVER_VERSION,
      paired: Boolean(storedToken),
      clients: clients.size,
      active: Boolean(activeClientId),
    }, origin);
  }

  async function handler(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${listeningPort}`}`);
    const origin = String(req.headers.origin || '');
    if (req.method === 'OPTIONS') {
      if (!originAllowed(origin)) {
        sendJson(res, 403, { ok: false, error: 'Origin is not allowed.' }, origin);
        return;
      }
      res.writeHead(204, corsHeaders(origin));
      res.end();
      return;
    }
    if (url.pathname === '/health' && req.method === 'GET') {
      handleHealth(req, res);
      return;
    }
    if (url.pathname === '/events' && req.method === 'GET') {
      handleEvents(req, res, url);
      return;
    }
    if (url.pathname === '/response' && req.method === 'POST') {
      await handleResponse(req, res, url);
      return;
    }
    sendJson(res, 404, { ok: false, error: 'Not found.' }, origin);
  }

  async function listen() {
    server = http.createServer((req, res) => {
      Promise.resolve(handler(req, res)).catch((error) => {
        if (!res.headersSent) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        } else {
          try { res.end(); } catch { /* noop */ }
        }
      });
    });
    server.timeout = 0;
    server.keepAliveTimeout = 0;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, HOST, () => {
        server.off('error', reject);
        const address = server.address();
        if (address && typeof address === 'object') listeningPort = address.port;
        resolve();
      });
    });
    const heartbeat = setInterval(() => {
      for (const client of clients.values()) {
        try { client.res.write(': ping\n\n'); } catch { /* close handler cleans up */ }
      }
    }, 15_000);
    heartbeat.unref?.();
    server.on('close', () => clearInterval(heartbeat));
    return { port: listeningPort, url: `http://${HOST}:${listeningPort}` };
  }

  async function close() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Bridge is shutting down.'));
    }
    pending.clear();
    for (const client of clients.values()) {
      try { client.res.end(); } catch { /* noop */ }
    }
    clients.clear();
    activeClientId = null;
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
      server = null;
    }
  }

  return {
    listen,
    close,
    requestBrowser,
    get port() { return listeningPort; },
    get clients() { return clients.size; },
    get paired() { return Boolean(storedToken); },
  };
}

async function callBrowserTool(bridge, name, args) {
  try {
    const timeout = name === 'dexter_compile_document' ? COMPILE_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    const result = await bridge.requestBrowser('tool_call', { name, arguments: args ?? {} }, timeout);
    if (result && Array.isArray(result.content)) return result;
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Dexter Write is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      }],
      isError: true,
    };
  }
}

function promptResult(name, args) {
  const prompt = PROMPTS.find((item) => item.name === name);
  if (!prompt) return null;
  const focus = typeof args?.focus === 'string' ? args.focus.trim() : '';
  const job = typeof args?.job_description === 'string' ? args.job_description.trim() : '';
  const file = typeof args?.file === 'string' ? args.file.trim() : '';
  let text;
  if (name === 'audit-academic-paper') {
    text = [
      'Audit the open Dexter Write project like a demanding but constructive academic reviewer.',
      `Focus: ${focus || 'overall structure, argument, evidence, citations, and build health'}.`,
      'Use dexter_list_project_files, dexter_read_project_file, dexter_get_outline, and dexter_get_diagnostics to inspect the real files.',
      'Report prioritized issues with file and line references. Then apply concrete, minimal fixes with dexter_stage_edit or dexter_insert_content.',
      'Call dexter_compile_document after build-related fixes and report any remaining warnings. Do not claim success without that call.',
      'Edits apply immediately and Undo remains available in Dexter Write.',
    ].join('\n');
  } else if (name === 'tailor-resume') {
    text = [
      'Tailor the active resume in Dexter Write to the target job without inventing experience, metrics, or credentials.',
      'Target job description:',
      job || '[No job description supplied. Ask me for the job description before editing.]',
      'Read the active resume and relevant project files first. Map existing evidence to the role, tighten wording, and reorder only what the evidence supports.',
      'Use dexter_stage_edit for precise edits. Explain every material change and list gaps I should address myself.',
      'Edits apply immediately and Undo remains available in Dexter Write.',
    ].join('\n');
  } else {
    text = [
      `Diagnose and fix build problems in ${file || 'the active LaTeX file'} in Dexter Write.`,
      'Call dexter_get_diagnostics first, then dexter_compile_document to reproduce the current failure.',
      'Read the failing file and referenced files. Identify the root cause before editing.',
      'Apply minimal fixes with dexter_stage_edit, then compile again and report the remaining diagnostics.',
      'Do not claim the build is fixed unless dexter_compile_document succeeds. Edits apply immediately; Undo remains available.',
    ].join('\n');
  }
  return {
    description: prompt.description,
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
}

async function handleRpc(bridge, message) {
  const validObject = Boolean(message) && typeof message === 'object' && !Array.isArray(message);
  const id = validObject && Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : undefined;
  const isNotification = id === undefined;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, text) => ({ jsonrpc: '2.0', id, error: { code, message: text } });

  if (!validObject || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return isNotification ? null : fail(-32600, 'Invalid JSON-RPC request.');
  }
  if (isNotification) {
    if (message.method === 'notifications/initialized') log('MCP client initialized.');
    return null;
  }

  switch (message.method) {
    case 'initialize': {
      const requested = message.params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : LATEST_LEGACY_PROTOCOL;
      return reply({
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
          prompts: { listChanged: false },
        },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      if (typeof name !== 'string' || !TOOL_NAMES.has(name)) {
        return fail(-32602, `Unknown tool: ${String(name)}`);
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return fail(-32602, 'Tool arguments must be an object.');
      }
      return reply(await callBrowserTool(bridge, name, args));
    }
    case 'resources/list':
      return reply({ resources: RESOURCES });
    case 'resources/templates/list':
      return reply({ resourceTemplates: [] });
    case 'resources/read': {
      const uri = message.params?.uri;
      if (typeof uri !== 'string' || !uri) return fail(-32602, 'Resource uri is required.');
      if (!RESOURCES.some((resource) => resource.uri === uri)) {
        return fail(-32602, `Unknown resource: ${uri}`);
      }
      try {
        const result = await bridge.requestBrowser('resource_read', { uri });
        const text = result && Array.isArray(result.content)
          ? result.content.map((part) => part?.text ?? '').join('\n')
          : JSON.stringify(result ?? '');
        return reply({ contents: [{ uri, mimeType: 'text/plain', text }] });
      } catch (error) {
        return fail(-32000, error instanceof Error ? error.message : String(error));
      }
    }
    case 'prompts/list':
      return reply({ prompts: PROMPTS });
    case 'prompts/get': {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      if (typeof name !== 'string') return fail(-32602, 'Prompt name is required.');
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return fail(-32602, 'Prompt arguments must be an object.');
      }
      const result = promptResult(name, args);
      if (!result) return fail(-32602, `Unknown prompt: ${name}`);
      return reply(result);
    }
    case 'notifications/cancelled':
      return null;
    default:
      return fail(-32601, `Method not found: ${message.method}`);
  }
}

function startStdio(bridge) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let closed = false;

  const shutdown = async () => {
    if (closed) return;
    closed = true;
    rl.close();
    await bridge.close();
    process.exit(0);
  };

  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } })}\n`);
      return;
    }
    Promise.resolve(handleRpc(bridge, message))
      .then((response) => {
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      })
      .catch((error) => {
        log(`RPC handler failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
        if (message && Object.prototype.hasOwnProperty.call(message, 'id')) {
          process.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32603, message: 'Internal error.' },
          })}\n`);
        }
      });
  });
  rl.on('close', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function tunnelSetupText() {
  const file = fileURLToPath(import.meta.url);
  const profile = 'dexter-write';
  const command = `tunnel-client init --sample sample_mcp_stdio_local --profile ${profile} --tunnel-id tunnel_YOUR_ID --mcp-command 'node "${file}"'`;
  const isWindows = process.platform === 'win32';
  return `ChatGPT web via OpenAI Secure MCP Tunnel

This connects chatgpt.com to the local Dexter Write MCP daemon without exposing a public port. The MCP server stays private; tunnel-client makes outbound HTTPS connections to OpenAI.

Requirements:
  - ChatGPT web access to custom MCP servers. Availability depends on your plan, workspace, and workspace permissions.
  - An OpenAI Platform tunnel and a runtime API key:
    https://platform.openai.com/settings/organization/tunnels
  - tunnel-client installed from:
    https://github.com/openai/tunnel-client/releases/latest

Setup (${isWindows ? 'PowerShell' : 'bash/zsh'}):
  1. Create a tunnel in Platform and associate it with your ChatGPT workspace.
  2. Set the runtime key in your shell. Do not paste it into ChatGPT or commit it.
     ${isWindows ? '$env:CONTROL_PLANE_API_KEY="sk-..."' : 'export CONTROL_PLANE_API_KEY="sk-..."'}
  3. Register this daemon:
     ${command}
  4. Validate and run:
     tunnel-client doctor --profile ${profile} --explain
     tunnel-client run --profile ${profile}
  5. Keep Dexter Write open and enable the MCP bridge in the app.
  6. In https://chatgpt.com/plugins, add a custom MCP server:
     Connection: Tunnel
     Tunnel: the tunnel created above
     Authentication: No authentication
     Create and install the plugin, then mention it with @ in a chat.

Notes:
  - Do not run "npm run mcp" at the same time; tunnel-client starts the daemon.
  - The daemon still listens on 127.0.0.1:${DEFAULT_PORT} for the open Dexter Write tab.
  - Reads are immediate. Edits and inserts apply directly in Dexter Write with a local undo snapshot.
  - Secure MCP Tunnel has a 120-second request deadline, so compile calls time out after ${COMPILE_TIMEOUT_MS / 1000} seconds here.
  - If ChatGPT does not list the tunnel, verify its ChatGPT workspace association and your Tunnels Read + Use permission.
`;
}

function printHelp() {
  process.stdout.write(`dexter-mcp ${SERVER_VERSION}

Usage:
  node bin/dexter-mcp.mjs                      Start the stdio MCP server + local browser bridge
  node bin/dexter-mcp.mjs --self-test          Run the local bridge loop test
  node bin/dexter-mcp.mjs --print-config       Print a Claude Desktop config snippet
  node bin/dexter-mcp.mjs --print-tunnel-setup Print ChatGPT web Secure MCP Tunnel setup
  node bin/dexter-mcp.mjs --reset-token        Forget the paired browser token before starting

Options:
  --port <n>                 Bridge port (default ${DEFAULT_PORT}, or DEXTER_MCP_PORT)
  --reset-token              Delete the persisted pairing token first

Capabilities:
  tools (8)                  Read, apply edits/inserts, compile, diagnostics
  resources (4)              dexter://document/*, project/files, compiler/diagnostics
  prompts (3)                audit-academic-paper, tailor-resume, fix-latex-errors
  Edits apply directly and keep an undo snapshot in Dexter Write.

Clients:
  Claude Desktop, Cursor     Local stdio MCP via --print-config
  ChatGPT web                Custom MCP server through OpenAI Secure MCP Tunnel
                             See --print-tunnel-setup

Environment:
  DEXTER_MCP_PORT            Bridge port
  DEXTER_MCP_TOKEN           Fixed pairing token (skips first-use pairing)
  DEXTER_MCP_TOKEN_FILE      Pairing token file (default ~/.dexter-write/mcp-token)
  DEXTER_MCP_ORIGIN          Extra comma-separated allowed browser origins
`);
}

function printConfig() {
  const file = fileURLToPath(import.meta.url);
  process.stdout.write(`${JSON.stringify({
    mcpServers: {
      'dexter-write': {
        command: 'node',
        args: [file],
      },
    },
  }, null, 2)}\n`);
}

async function openSse(url, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${url}/events?token=${encodeURIComponent(token)}`, {
      headers: { Origin: 'http://localhost:5173', Accept: 'text/event-stream' },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`SSE connect failed with HTTP ${res.statusCode}`));
        return;
      }
      resolve({ req, res });
    });
    req.on('error', reject);
  });
}

async function postResponse(url, token, body) {
  const res = await fetch(`${url}/response?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Response POST failed with HTTP ${res.status}`);
}

async function runSelfTest() {
  const token = `selftest_${crypto.randomUUID()}`;
  const bridge = createBridge({ port: 0, token, persistToken: false });
  const { url } = await bridge.listen();
  const hello = await openSse(url, token);
  let buffer = '';
  let answered = 0;
  const expectedAnswers = 2;
  let finishAnswers;
  let answerTimer;
  const answersDone = new Promise((resolve, reject) => {
    finishAnswers = resolve;
    answerTimer = setTimeout(() => reject(new Error('Browser simulator timed out.')), 5000);
    hello.res.setEncoding('utf8');
    hello.res.on('data', (chunk) => {
      buffer += chunk;
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const event = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim();
        const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (event !== 'request' || !data) continue;
        const message = JSON.parse(data);
        const result = message.method === 'resource_read'
          ? { content: [{ type: 'text', text: 'resource-ok' }] }
          : { content: [{ type: 'text', text: `tool-ok:${message.params?.name ?? ''}` }] };
        postResponse(url, token, { id: message.id, ok: true, result })
          .then(() => {
            answered += 1;
            if (answered >= expectedAnswers) finishAnswers();
          })
          .catch(reject);
      }
    });
  });

  const toolResult = await bridge.requestBrowser('tool_call', {
    name: 'dexter_list_project_files',
    arguments: {},
  });
  assert.equal(toolResult.content[0].text, 'tool-ok:dexter_list_project_files');

  const initialized = await handleRpc(bridge, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25' },
  });
  assert.equal(initialized.result.protocolVersion, LATEST_LEGACY_PROTOCOL);
  assert.equal(initialized.result.serverInfo.name, SERVER_NAME);
  assert.ok(initialized.result.capabilities.resources);
  assert.ok(initialized.result.capabilities.prompts);
  assert.match(initialized.result.instructions, /dexter_stage_edit/);
  assert.match(initialized.result.instructions, /apply immediately/i);

  const legacy = await handleRpc(bridge, {
    jsonrpc: '2.0',
    id: 7,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05' },
  });
  assert.equal(legacy.result.protocolVersion, '2024-11-05');

  const listed = await handleRpc(bridge, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.equal(listed.result.tools.length, 8);
  for (const tool of listed.result.tools) {
    assert.equal(tool.annotations.openWorldHint, false);
    if (tool.name === 'dexter_stage_edit' || tool.name === 'dexter_insert_content') {
      assert.equal(tool.annotations.readOnlyHint, false);
    } else {
      assert.equal(tool.annotations.readOnlyHint, true);
    }
  }
  const resources = await handleRpc(bridge, { jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} });
  assert.equal(resources.result.resources.length, 4);
  const read = await handleRpc(bridge, {
    jsonrpc: '2.0',
    id: 4,
    method: 'resources/read',
    params: { uri: 'dexter://document/active' },
  });
  assert.equal(read.result.contents[0].text, 'resource-ok');
  const prompts = await handleRpc(bridge, { jsonrpc: '2.0', id: 5, method: 'prompts/list', params: {} });
  assert.equal(prompts.result.prompts.length, 3);
  const prompt = await handleRpc(bridge, {
    jsonrpc: '2.0',
    id: 6,
    method: 'prompts/get',
    params: { name: 'fix-latex-errors', arguments: {} },
  });
  assert.match(prompt.result.messages[0].content.text, /dexter_get_diagnostics/);
  const tunnelSetup = tunnelSetupText();
  assert.match(tunnelSetup, /tunnel-client init/);
  assert.match(tunnelSetup, /dexter-mcp\.mjs/);
  assert.match(tunnelSetup, /chatgpt\.com\/plugins/);
  await answersDone;
  clearTimeout(answerTimer);

  hello.req.destroy();
  await bridge.close();
  process.stdout.write('dexter-mcp self-test passed\n');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }
  if (process.argv.includes('--print-config')) {
    printConfig();
    return;
  }
  if (process.argv.includes('--print-tunnel-setup')) {
    process.stdout.write(tunnelSetupText());
    return;
  }
  if (process.argv.includes('--self-test')) {
    await runSelfTest();
    return;
  }

  const reset = process.argv.includes('--reset-token');
  if (reset) {
    try { fs.rmSync(tokenFilePath(), { force: true }); } catch { /* ignore */ }
  }
  const token = process.env.DEXTER_MCP_TOKEN || readTokenFile();
  const rawPort = argValue('--port') || process.env.DEXTER_MCP_PORT || String(DEFAULT_PORT);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    log(`Invalid port: ${rawPort}`);
    process.exit(1);
  }

  const bridge = createBridge({ port, token, persistToken: !process.env.DEXTER_MCP_TOKEN });
  try {
    const { url } = await bridge.listen();
    log(`stdio MCP server ready; browser bridge listening on ${url}`);
    if (token) log('Using an existing pairing token. Run with --reset-token to re-pair.');
  } catch (error) {
    log(`Could not start bridge: ${error instanceof Error ? error.message : String(error)}`);
    if (error && error.code === 'EADDRINUSE') {
      log(`Port ${port} is in use. Another dexter-mcp may already be running; stop it or set DEXTER_MCP_PORT.`);
    }
    process.exit(1);
  }
  startStdio(bridge);
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((error) => {
    log(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
