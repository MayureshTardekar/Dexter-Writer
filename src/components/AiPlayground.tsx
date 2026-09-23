import { useRef, useState, type MutableRefObject } from 'react';
import { buildSystemPrompt, callLlm, type ChatHistoryItem, type ExtraToolDef, type ProviderId } from '../lib/aiGateway';
import { getDocumentOutline } from '../lib/docUtils';
import { executeVirtualTool, toolBadge, type McpToolCall } from '../lib/virtualMcp';
import { insertContent as strInsert, replaceLines as strReplace } from '../lib/virtualMcp';
import {
  callExternalTool,
  enabledExternalDefs,
  getStoredPermission,
  setStoredPermission,
  type ExternalMcpServer,
  type LlmExternalDef,
} from '../lib/externalMcp';
import { monacoLanguageFor } from '../lib/monacoTypst';
import DiffReviewModal from './DiffReviewModal';
import type { DocMode } from '../lib/templates';
import { saveSnapshot } from '../lib/history';

export interface SelectionCtx {
  text: string;
  startLine: number;
  endLine: number;
}

interface Props {
  docContent: string;
  setDocContent: (v: string) => void;
  docMode: DocMode;
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
  selection: SelectionCtx | null;
  clearSelection: () => void;
  editorRef: MutableRefObject<unknown>;
  servers: ExternalMcpServer[];
  theme: 'dark' | 'light';
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  badges?: string[];
}

interface PermRequest {
  defName: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
}

const VIRTUAL_NAMES = new Set([
  'read_document_content', 'get_document_content', 'get_document_outline',
  'insert_content', 'insert_text', 'replace_lines', 'propose_diff',
]);

function applyViaMonaco(editorRef: MutableRefObject<unknown>, current: string, call: McpToolCall): string | null {
  try {
    const holder = editorRef.current as unknown as { _editor?: { getModel: () => unknown; executeEdits: (src: string, ops: unknown[]) => void }; _monaco?: { Range: new (...a: number[]) => unknown } } | null;
    const ed = holder?._editor;
    const monaco = holder?._monaco;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = ed as any;
    if (!editor || !monaco) return null;
    const model = editor.getModel();
    if (!model) return null;
    const Range = (monaco as { Range: new (...a: number[]) => unknown }).Range;
    const a = call.args;
    if (call.name === 'replace_lines') {
      const s = Number(a.start_line ?? 1);
      const e = Number(a.end_line ?? s);
      const maxCol = model.getLineMaxColumn(e);
      editor.executeEdits('virtual-mcp-ai', [{ range: new Range(s, 1, e, maxCol), text: String(a.new_text ?? ''), forceMoveMarkers: true }]);
      return model.getValue();
    }
    if (call.name === 'insert_content' || call.name === 'insert_text') {
      const target = Number(a.target_line ?? 1);
      const pos = (a.position as string) ?? 'after';
      const text = String(a.text ?? '');
      if (pos === 'before') {
        editor.executeEdits('virtual-mcp-ai', [{ range: new Range(target, 1, target, 1), text: text + '\n', forceMoveMarkers: true }]);
      } else {
        const maxCol = model.getLineMaxColumn(Math.min(target, model.getLineCount()));
        editor.executeEdits('virtual-mcp-ai', [{ range: new Range(target, maxCol, target, maxCol), text: '\n' + text, forceMoveMarkers: true }]);
      }
      return model.getValue();
    }
    return current;
  } catch {
    return null;
  }
}

export default function AiPlayground({ docContent, setDocContent, docMode, provider, apiKey, model, baseUrl, selection, clearSelection, editorRef, servers, theme }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'assistant', text: 'Hi! I can read, outline, insert and rewrite your document via MCP tools — plus any connected external MCP servers. Toggle Diff Review to approve edits per-chunk.' },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [diffMode, setDiffMode] = useState(true);
  const [pending, setPending] = useState<{ summary: string; before: string; after: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [permReq, setPermReq] = useState<PermRequest | null>(null);
  const permResolver = useRef<((v: 'once' | 'always' | 'deny') => void) | null>(null);
  const contentRef = useRef(docContent);
  contentRef.current = docContent;
  const serversRef = useRef(servers);
  serversRef.current = servers;

  function requestPermission(def: LlmExternalDef, serverName: string, args: Record<string, unknown>): Promise<'once' | 'always' | 'deny'> {
    return new Promise((resolve) => {
      permResolver.current = resolve;
      setPermReq({ defName: def.defName, serverName, toolName: def.toolName, args });
    });
  }

  function resolvePerm(v: 'once' | 'always' | 'deny') {
    setPermReq(null);
    permResolver.current?.(v);
    permResolver.current = null;
  }

  function stageOrApply(call: McpToolCall, badges: string[]): void {
    const cur = contentRef.current;
    saveSnapshot('active', 'active-file', cur, `Pre-AI: ${call.name}`).catch(() => {});
    if (call.name === 'insert_content' || call.name === 'insert_text') {
      const via = applyViaMonaco(editorRef, cur, call);
      if (diffMode) {
        const r = strInsert(cur, Number(call.args.target_line ?? 1), ((call.args.position as string) ?? 'after') as 'before' | 'after', String(call.args.text ?? ''));
        if (r.newContent !== undefined) setPending({ summary: toolBadge(call), before: cur, after: r.newContent });
        badges.push(toolBadge(call) + ' (staged)');
      } else if (via !== null) {
        setDocContent(via);
        badges.push(toolBadge(call));
      } else {
        const r = strInsert(cur, Number(call.args.target_line ?? 1), ((call.args.position as string) ?? 'after') as 'before' | 'after', String(call.args.text ?? ''));
        if (r.newContent !== undefined) setDocContent(r.newContent);
        badges.push(toolBadge(call));
      }
      return;
    }
    if (call.name === 'replace_lines') {
      if (diffMode) {
        const r = strReplace(cur, Number(call.args.start_line ?? 1), Number(call.args.end_line ?? 1), String(call.args.new_text ?? ''));
        if (r.newContent !== undefined) setPending({ summary: toolBadge(call), before: cur, after: r.newContent });
        badges.push(toolBadge(call) + ' (staged)');
      } else {
        const via = applyViaMonaco(editorRef, cur, call);
        if (via !== null) {
          setDocContent(via);
          badges.push(toolBadge(call));
        } else {
          const r = strReplace(cur, Number(call.args.start_line ?? 1), Number(call.args.end_line ?? 1), String(call.args.new_text ?? ''));
          if (r.newContent !== undefined) setDocContent(r.newContent);
          badges.push(toolBadge(call));
        }
      }
    }
  }

  async function runToolCalls(
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
    defs: LlmExternalDef[],
    badges: string[],
    toolResults: string[],
  ): Promise<void> {
    for (const tc of toolCalls.slice(0, 6)) {
      if (VIRTUAL_NAMES.has(tc.name)) {
        const res = executeVirtualTool(contentRef.current, docMode, { name: tc.name, args: tc.args });
        if (res.resultText !== undefined) {
          badges.push(toolBadge({ name: tc.name, args: tc.args }));
          toolResults.push(`[${tc.name} result]\n${res.resultText.slice(0, 2500)}`);
        } else if (res.newContent !== undefined || tc.name.includes('insert') || tc.name.includes('replace')) {
          stageOrApply({ name: tc.name, args: tc.args }, badges);
          if (!diffMode) toolResults.push(`[${tc.name}] ${res.message}`);
        } else {
          toolResults.push(`[${tc.name}] ${res.message}`);
        }
        continue;
      }
      // External MCP tool
      const def = defs.find((d) => d.defName === tc.name);
      if (!def) {
        toolResults.push(`[${tc.name}] Unknown tool — ignored.`);
        continue;
      }
      const srv = serversRef.current.find((s) => s.id === def.serverId);
      if (!srv || srv.status !== 'connected') {
        toolResults.push(`[${tc.name}] Server unavailable — ask the user to connect it in the MCP manager.`);
        continue;
      }
      const stored = getStoredPermission(def.serverId, def.toolName);
      let decision: 'once' | 'always' | 'deny';
      if (stored === 'allow-always') decision = 'always';
      else if (stored === 'deny') decision = 'deny';
      else decision = await requestPermission(def, srv.name, tc.args);
      if (decision === 'deny') {
        badges.push(`⛔ ${srv.name}: ${def.toolName} denied`);
        toolResults.push(`[${tc.name}] Denied by user.`);
        continue;
      }
      if (decision === 'always') setStoredPermission(def.serverId, def.toolName, 'allow-always');
      try {
        const text = await callExternalTool(srv, def.toolName, tc.args);
        badges.push(`🔌 ${srv.name}: ${def.toolName}`);
        toolResults.push(`[${def.toolName} @ ${srv.name}]\n${text.slice(0, 2500)}`);
      } catch (e) {
        toolResults.push(`[${tc.name}] External call failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  async function send(promptOverride?: string) {
    const prompt = (promptOverride ?? input).trim();
    if (!prompt || sending) return;
    if (provider !== 'ollama' && !apiKey) {
      setMessages((m) => [...m, { role: 'user', text: prompt }, { role: 'assistant', text: '⚠️ No API key set. Open **BYOK** (top-right) and save a key, or switch to Ollama local.' }]);
      setInput('');
      return;
    }
    setSending(true);
    setInput('');
    let selCtx = '';
    if (selection && selection.text) selCtx = `\n\n[Selected Lines ${selection.startLine}-${selection.endLine}]:\n${selection.text.slice(0, 3000)}`;
    const userText = prompt + selCtx;
    setMessages((m) => [...m, { role: 'user', text: userText }]);

    try {
      const defs = enabledExternalDefs(serversRef.current);
      const extra: ExtraToolDef[] = defs.map((d) => ({ name: d.defName, description: d.description, parameters: d.parameters }));
      const externalHint = defs.length > 0
        ? `Connected external MCP tools:\n${defs.map((d) => `- ${d.defName}: ${(d.description || '').slice(0, 100)}`).join('\n').slice(0, 1500)}`
        : '';
      const outline = getDocumentOutline(contentRef.current, docMode);
      const outlineText = outline.map((o) => `- ${o.title} (line ${o.line})`).join('\n');
      const system = buildSystemPrompt(docMode, outlineText, contentRef.current, externalHint);
      const history: ChatHistoryItem[] = messages.slice(-8).map((m) => ({ role: m.role, text: m.text.slice(0, 2000) }));

      const turn = await callLlm(provider, { apiKey, baseUrl, model }, system, history, userText, extra);
      const badges: string[] = [];
      const toolResults: string[] = [];
      await runToolCalls(turn.toolCalls, defs, badges, toolResults);

      let finalText = turn.text;
      if (toolResults.length > 0) {
        const follow = await callLlm(
          provider, { apiKey, baseUrl, model }, system,
          [...history, { role: 'user', text: userText }],
          `Tool results:\n${toolResults.join('\n\n')}\n\nRespond concisely. ${diffMode ? 'Document edits are staged for user review — summarize them.' : 'Edits applied — summarize with line numbers.'}`,
          extra,
        );
        if (follow.text) finalText = follow.text;
        await runToolCalls(follow.toolCalls, defs, badges, toolResults);
      }

      setMessages((m) => [...m, { role: 'assistant', text: finalText || (badges.length ? 'Done — see tool activity above.' : 'No changes made.'), badges }]);
      clearSelection();
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `❌ ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setSending(false);
    }
  }

  function toggleVoice() {
    const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setMessages((m) => [...m, { role: 'assistant', text: '🎙️ Voice not supported in this browser. Try Chrome/Edge.' }]);
      return;
    }
    if (listening) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = new (SR as any)();
      rec.lang = 'en-US';
      rec.interimResults = false;
      setListening(true);
      rec.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
        const t = e.results[0]?.[0]?.transcript ?? '';
        if (t) setInput((v) => (v ? v + ' ' : '') + t);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      rec.start();
    } catch {
      setListening(false);
    }
  }

  return (
    <div className="ai-col">
      <div className="ai-controls">
        <label className="switch">
          <input type="checkbox" checked={diffMode} onChange={(e) => setDiffMode(e.target.checked)} />
          Diff Review
        </label>
        <span className="muted small">{diffMode ? 'AI stages edits' : 'Auto-Apply on'}</span>
      </div>
      {selection && selection.text && (
        <div className="sel-chip">
          <span>Lines {selection.startLine}-{selection.endLine} selected ({selection.text.length} chars)</span>
          <button className="btn xs" onClick={() => send(`Explain and improve this selection:\n${selection.text.slice(0, 2000)}`)}>Ask AI</button>
          <button className="btn xs ghost" onClick={clearSelection}>✕</button>
        </div>
      )}
      <div className="chat-feed">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.badges?.map((b, j) => <div key={j} className="badge">{b}</div>)}
            <div className="bubble-text">{m.text}</div>
          </div>
        ))}
        {sending && <div className="bubble assistant"><div className="bubble-text">Thinking + running MCP tools…</div></div>}
      </div>
      <div className="chat-input">
        <button className={`btn icon ${listening ? 'rec' : ''}`} onClick={toggleVoice} title="Voice to document" aria-label="Voice input">🎙️</button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask AI… (Enter to send, Ctrl+Enter newline)"
          aria-label="AI prompt"
        />
        <button className="btn primary" onClick={() => send()} disabled={sending}>Send</button>
      </div>
      {pending && (
        <DiffReviewModal
          summary={pending.summary}
          before={pending.before}
          after={pending.after}
          language={monacoLanguageFor(docMode)}
          theme={theme}
          onAccept={(final) => {
            setDocContent(final);
            setMessages((m) => [...m, { role: 'assistant', text: `✅ Accepted: ${pending.summary}` }]);
            setPending(null);
          }}
          onClose={() => setPending(null)}
        />
      )}
      {permReq && (
        <div className="modal-backdrop" role="dialog" aria-label="MCP permission request">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>🔌 Allow MCP tool call?</h3>
            <p><strong>{permReq.serverName}</strong> → <code>{permReq.toolName}</code></p>
            <pre className="perm-args">{JSON.stringify(permReq.args, null, 2).slice(0, 1500)}</pre>
            <div className="row end">
              <button className="btn danger" onClick={() => resolvePerm('deny')}>Deny</button>
              <button className="btn" onClick={() => resolvePerm('once')}>Allow once</button>
              <button className="btn primary" onClick={() => resolvePerm('always')}>Always allow</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
