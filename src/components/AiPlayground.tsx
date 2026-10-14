import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import {
  buildSystemPrompt,
  buildToolDefs,
  detectDocMacros,
  executeTool,
  externalToToolDefs,
  renderFileList,
  resolveProvider,
  runAgent,
  type AgentMessage,
  type FileAccess,
  type ToolCall,
  type ToolContext,
  type ToolResult,
} from '../lib/agent';
import { getDocumentOutline } from '../lib/docUtils';
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
import ModalHeader from './ModalHeader';
import ChatMarkdown from './ChatMarkdown';
import Icon from './icons';
import type { DocMode } from '../lib/templates';
import { saveSnapshot, formatTimeAgo } from '../lib/history';
import { toast } from '../lib/toast';
import {
  deleteConversation,
  loadConversations,
  newConversationId,
  saveConversation,
  titleFor,
  type ChatConversation,
} from '../lib/chatHistory';

export interface SelectionCtx {
  text: string;
  startLine: number;
  endLine: number;
}

interface Props {
  docContent: string;
  setDocContent: (v: string) => void;
  docMode: DocMode;
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  selection: SelectionCtx | null;
  clearSelection: () => void;
  editorRef: MutableRefObject<unknown>;
  servers: ExternalMcpServer[];
  theme: 'dark' | 'light';
  onOpenReview?: () => void;
  fileName?: string;
  /** Active file id — snapshots must be keyed by it to show up in History. */
  fileId?: string;
  /** Cross-file tool access. Omit to disable list_files / read_file / edit_file. */
  files?: FileAccess;
}

type ToolStatus = 'running' | 'done' | 'error';

interface ToolRow {
  id: string;
  label: string;
  status: ToolStatus;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Persisted summary of tool activity (StoredMessage-compatible). */
  badges?: string[];
  tools?: ToolRow[];
  notices?: string[];
  streaming?: boolean;
  stopped?: boolean;
  failed?: boolean;
}

interface PermRequest {
  defName: string;
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `m${Date.now().toString(36)}_${idSeq.toString(36)}`;
}

/** Extract the first fenced code block, if the message carries document code. */
function codeBlockOf(text: string): string | null {
  const match = /```(?:latex|tex|markdown|md|typst|typ)?\s*\n([\s\S]*?)```/i.exec(text);
  const code = match?.[1]?.trim();
  return code ? code : null;
}

/** Human label for a tool call while it is still running. */
function labelForCall(call: ToolCall): string {
  const a = call.args ?? {};
  switch (call.name) {
    case 'read_document_content':
    case 'get_document_content':
      return `Reading lines ${String(a.start_line ?? 1)}-${String(a.end_line ?? 'end')}`;
    case 'get_document_outline':
      return 'Reading outline';
    case 'search_document':
      return `Searching "${String(a.pattern ?? '').slice(0, 28)}"`;
    case 'edit_document':
      return 'Editing document';
    case 'insert_content':
    case 'insert_text':
      return `Inserting at line ${String(a.target_line ?? '?')}`;
    case 'replace_lines':
      return `Replacing lines ${String(a.start_line ?? '?')}-${String(a.end_line ?? '?')}`;
    case 'list_files':
      return 'Listing project files';
    case 'read_file':
      return `Reading ${String(a.name ?? 'file')}`;
    case 'create_file':
      return `Creating ${String(a.name ?? 'file')}`;
    case 'edit_file':
      return `Editing ${String(a.name ?? 'file')}`;
    default:
      return call.name.startsWith('mcp_') ? `MCP: ${call.name.slice(4)}` : call.name;
  }
}

function insertAtCursor(editorRef: MutableRefObject<unknown>, text: string): boolean {
  try {
    const holder = editorRef.current as unknown as {
      _editor?: { getPosition: () => { lineNumber: number; column: number }; executeEdits: (src: string, ops: unknown[]) => void; focus: () => void };
      _monaco?: { Range: new (...a: number[]) => unknown };
    } | null;
    const ed = holder?._editor;
    const monaco = holder?._monaco;
    if (ed && monaco) {
      const pos = ed.getPosition();
      const Range = monaco.Range;
      ed.executeEdits('ai-insert', [{
        range: new Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        text,
        forceMoveMarkers: true,
      }]);
      ed.focus();
      return true;
    }
  } catch { /* noop */ }
  return false;
}

export default function AiPlayground({
  docContent,
  setDocContent,
  docMode,
  provider,
  apiKey,
  model,
  baseUrl,
  selection,
  clearSelection,
  editorRef,
  servers,
  theme,
  onOpenReview,
  fileName,
  fileId,
  files,
}: Props) {
  const greeting = (): ChatMsg => ({
    id: nextId(),
    role: 'assistant',
    text: 'Hi! I can read, search, outline, insert and rewrite your document — and work across the other files in this project. Toggle **Diff Review** to approve edits chunk by chunk.',
  });

  const [initialConvos] = useState<ChatConversation[]>(() => loadConversations());
  const [convId, setConvId] = useState<string>(() => initialConvos[0]?.id ?? newConversationId());
  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    const stored = initialConvos[0]?.messages;
    if (!stored || stored.length === 0) return [greeting()];
    return stored.map((m) => ({ id: nextId(), role: m.role, text: m.text, badges: m.badges }));
  });
  const [recents, setRecents] = useState<ChatConversation[]>(() => initialConvos);
  const [showRecents, setShowRecents] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [diffMode, setDiffMode] = useState(true);
  const [pending, setPending] = useState<{ summary: string; before: string; after: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [permReq, setPermReq] = useState<PermRequest | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const permResolver = useRef<((v: 'once' | 'always' | 'deny') => void) | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const contentRef = useRef(docContent);
  contentRef.current = docContent;
  const serversRef = useRef(servers);
  serversRef.current = servers;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const filesRef = useRef(files);
  filesRef.current = files;

  /** Cumulative staged content across all tool calls in one turn. */
  const stagedRef = useRef<string | null>(null);
  /** Document content at the start of the turn — the diff's "before". */
  const turnBaseRef = useRef<string>(docContent);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function patchMsg(id: string, patch: Partial<ChatMsg>) {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  // Keep the latest message in view, but don't yank while the user scrolls up.
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom || sending) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // Abort any in-flight run when this pane unmounts (sidebar tab switch).
  useEffect(() => () => abortRef.current?.abort(), []);

  // Autosave the conversation (debounced) so recents survive reloads.
  useEffect(() => {
    if (!messages.some((m) => m.role === 'user')) return;
    const t = window.setTimeout(() => {
      saveConversation({
        id: convId,
        title: titleFor(messages),
        fileName,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: messages.map((m) => ({
          role: m.role,
          text: m.text,
          badges: m.badges ?? m.tools?.map((t) => t.label),
        })),
      });
      setRecents(loadConversations());
    }, 800);
    return () => window.clearTimeout(t);
  }, [messages, convId, fileName]);

  function openConvo(id: string) {
    const c = recents.find((r) => r.id === id);
    if (!c) return;
    setConvId(c.id);
    setMessages(c.messages.map((m) => ({ id: nextId(), role: m.role, text: m.text, badges: m.badges })));
    setShowRecents(false);
  }

  function newChat() {
    setConvId(newConversationId());
    setMessages([greeting()]);
    setShowRecents(false);
  }

  function removeConvo(id: string) {
    const rest = deleteConversation(id);
    setRecents(rest);
    if (id === convId) {
      setConvId(newConversationId());
      setMessages([greeting()]);
    }
  }

  function copyMessage(id: string, text: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopiedIdx(id);
        setTimeout(() => setCopiedIdx((c) => (c === id ? null : c)), 1400);
      },
      () => {},
    );
  }

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

  /** Stage (diff review) or apply (auto) a document mutation from a tool. */
  function stageOrApply(result: ToolResult) {
    const next = result.newContent;
    if (next === undefined) return;
    saveSnapshot(fileId ?? 'active', fileName ?? 'active-file', contentRef.current, `Pre-AI: ${result.name}`).catch(() => {});
    if (diffMode) {
      stagedRef.current = next;
      const label = result.badge ?? result.name;
      setPending((prev) => ({
        summary: prev && prev.before === turnBaseRef.current ? `${prev.summary} · ${label}` : label,
        before: turnBaseRef.current,
        after: next,
      }));
    } else {
      contentRef.current = next;
      setDocContent(next);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function send(promptOverride?: string, opts?: { raw?: boolean }) {
    const prompt = (promptOverride ?? input).trim();
    if (!prompt || sending) return;

    if (resolveProvider(provider).needsKey && !apiKey) {
      setMessages((m) => [
        ...m,
        { id: nextId(), role: 'user', text: prompt },
        { id: nextId(), role: 'assistant', text: '⚠️ No API key set. Open **BYOK** (top-right) and save a key, or switch to Ollama local.', failed: true },
      ]);
      setInput('');
      return;
    }

    setSending(true);
    setInput('');
    stagedRef.current = null;
    turnBaseRef.current = contentRef.current;
    setPending(null);

    const selCtx = !opts?.raw && selection?.text
      ? `\n\n[Selected Lines ${selection.startLine}-${selection.endLine}]:\n${selection.text.slice(0, 3000)}`
      : '';
    const userText = prompt + selCtx;

    // History from the visible transcript, before this turn is appended.
    const history: AgentMessage[] = [];
    for (const m of messagesRef.current.slice(-8)) {
      if (!m.text.trim()) continue;
      if (m.role === 'assistant') history.push({ role: 'assistant', content: m.text.slice(0, 2000) });
      else history.push({ role: 'user', content: m.text.slice(0, 2000) });
    }

    const assistantId = nextId();
    setMessages((m) => [
      ...m,
      { id: nextId(), role: 'user', text: userText },
      { id: assistantId, role: 'assistant', text: '', tools: [], streaming: true },
    ]);

    const ac = new AbortController();
    abortRef.current = ac;

    // --- tool wiring -------------------------------------------------------
    const defs = enabledExternalDefs(serversRef.current);
    const externalDefs = externalToToolDefs(defs);

    const callExternal = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const def = defs.find((d) => d.defName === name);
      if (!def) throw new Error('Unknown external tool.');
      const srv = serversRef.current.find((s) => s.id === def.serverId);
      if (!srv || srv.status !== 'connected') {
        throw new Error('That MCP server is not connected. Ask the user to connect it in the MCP manager.');
      }
      const stored = getStoredPermission(def.serverId, def.toolName);
      let decision: 'once' | 'always' | 'deny';
      if (stored === 'allow-always') decision = 'always';
      else if (stored === 'deny') decision = 'deny';
      else decision = await requestPermission(def, srv.name, args);
      if (decision === 'deny') throw new Error('The user denied permission for this tool.');
      if (decision === 'always') setStoredPermission(def.serverId, def.toolName, 'allow-always');
      return callExternalTool(srv, def.toolName, args);
    };

    const toolCtx: ToolContext = {
      getContent: () => stagedRef.current ?? contentRef.current,
      mode: docMode,
      files: filesRef.current,
      external: externalDefs,
      callExternal,
    };

    const runTool = async (call: ToolCall): Promise<ToolResult> => {
      const result = await executeTool(toolCtx, call);
      if (result.newContent !== undefined) stageOrApply(result);
      return result;
    };

    // --- prompt ------------------------------------------------------------
    const outline = getDocumentOutline(contentRef.current, docMode);
    const outlineText = outline.map((o) => `- ${o.title} (line ${o.line})`).join('\n');
    const detected = detectDocMacros(contentRef.current, docMode);
    const macroHint = detected.length > 0
      ? `- Custom macros defined in THIS document (reuse them; NEVER emit a macro call that is not defined here or in standard LaTeX): ${detected.map((m) => `\\${m}`).join(', ')}`
      : '- The document defines no custom macros — use only standard commands and the environments already present. NEVER invent macros like \\resumeItem or \\resumeSubheading.';
    const selHint = selection?.text
      ? `- The user selected lines ${selection.startLine}-${selection.endLine}. If this is an EDIT request, change that range. If it is a QUESTION, just answer — no tools.`
      : '';
    const externalHint = defs.length > 0
      ? `Connected external MCP tools:\n${defs.map((d) => `- ${d.defName}: ${(d.description || '').slice(0, 100)}`).join('\n').slice(0, 1500)}`
      : '';
    const fileList = filesRef.current ? renderFileList(filesRef.current) : '';

    const system = buildSystemPrompt(
      docMode,
      outlineText,
      contentRef.current,
      externalHint,
      fileName,
      `${macroHint}\n${selHint}`,
      { fileList },
    );

    // --- run ---------------------------------------------------------------
    let buffer = '';
    let lastFlush = 0;
    const rows: ToolRow[] = [];
    const notices: string[] = [];
    let stoppedEarly = false;
    let failed = false;

    const flush = (force = false) => {
      const now = Date.now();
      if (!force && now - lastFlush < 50) return;
      lastFlush = now;
      patchMsg(assistantId, { text: buffer });
    };

    try {
      for await (const ev of runAgent({
        provider,
        apiKey,
        baseUrl,
        model,
        system,
        history,
        userText,
        tools: buildToolDefs(toolCtx),
        executeTool: runTool,
        signal: ac.signal,
      })) {
        switch (ev.type) {
          case 'text':
            buffer += ev.delta;
            flush();
            break;
          case 'tool_call':
            rows.push({ id: ev.call.id, label: labelForCall(ev.call), status: 'running' });
            patchMsg(assistantId, { tools: [...rows] });
            break;
          case 'tool_result': {
            const row = rows.find((r) => r.id === ev.result.toolCallId);
            if (row) {
              row.status = ev.result.isError ? 'error' : 'done';
              if (ev.result.badge) row.label = ev.result.badge;
              else if (ev.result.isError) row.label = `${row.label} — failed`;
              patchMsg(assistantId, { tools: [...rows] });
            }
            break;
          }
          case 'notice':
            notices.push(ev.message);
            patchMsg(assistantId, { notices: [...notices] });
            break;
          case 'error':
            failed = true;
            buffer += `${buffer ? '\n\n' : ''}❌ ${ev.message}`;
            flush(true);
            break;
          case 'round':
            break;
          case 'done':
            stoppedEarly = ev.stopReason === 'aborted';
            break;
        }
      }
    } catch (err) {
      failed = true;
      buffer += `${buffer ? '\n\n' : ''}❌ ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      flush(true);
      const didWork = rows.length > 0;
      const finalText = buffer
        || (stoppedEarly ? '_Stopped._' : didWork ? 'Done — see the tool activity above.' : 'No changes made.');
      patchMsg(assistantId, {
        text: finalText,
        streaming: false,
        stopped: stoppedEarly,
        failed,
        tools: [...rows],
        badges: rows.map((r) => r.label),
      });
      abortRef.current = null;
      setSending(false);
      if (!stoppedEarly) clearSelection();
    }
  }

  /** Re-run the last user prompt, dropping the replies it produced. */
  function regenerate() {
    if (sending) return;
    const msgs = messagesRef.current;
    let i = msgs.length - 1;
    while (i >= 0 && msgs[i].role !== 'user') i -= 1;
    if (i < 0) return;
    const prompt = msgs[i].text;
    const trimmed = msgs.slice(0, i);
    messagesRef.current = trimmed;
    setMessages(trimmed);
    void send(prompt, { raw: true });
  }

  function toggleVoice() {
    const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setMessages((m) => [...m, { id: nextId(), role: 'assistant', text: '🎙️ Voice not supported in this browser. Try Chrome/Edge.' }]);
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

  const lastMsg = messages[messages.length - 1];
  const canRegenerate = !sending && messages.some((m) => m.role === 'user');

  return (
    <div className="ai-col">
      <div className="ai-controls">
        <label className="switch">
          <input type="checkbox" checked={diffMode} onChange={(e) => setDiffMode(e.target.checked)} />
          Diff Review
        </label>
        <span className="muted small">{diffMode ? 'AI stages edits' : 'Auto-Apply on'}</span>
        {fileName && (
          <span className="ai-file-pill" title={`Target: ${fileName} (${docMode}) · ${docContent.split('\n').length} lines in AI context`}>
            <Icon name="fileText" size={11} /> {fileName} · {docContent.split('\n').length}L
          </span>
        )}
        <div className="spacer" />
        <button
          className="btn xs ghost"
          onClick={() => {
            setRecents(loadConversations());
            setShowRecents((v) => !v);
          }}
          title="Recent conversations"
          aria-label="Recent conversations"
        >
          <Icon name="history" size={13} /> <span className="btn-label optional">Recents</span>
        </button>
        {onOpenReview && (
          <button className="btn xs ghost" onClick={onOpenReview} title="Autonomous Document Review Agent">
            <Icon name="sparkles" size={13} /> <span className="btn-label optional">Audit</span>
          </button>
        )}
      </div>

      {selection && selection.text && (
        <div className="sel-chip">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '120px' }}>
            <Icon name="quote" size={13} />
            <span style={{ fontWeight: 600 }}>Lines {selection.startLine}-{selection.endLine}</span>
            <span className="muted small hide-sm">({selection.text.length} chars)</span>
          </div>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center', marginLeft: 'auto' }}>
            <button
              className="btn xs primary"
              title="Surgically rewrite the selected lines"
              onClick={() => send(`Rewrite the selected lines ${selection.startLine}-${selection.endLine} with edit_document. Make it concise and punchy, and keep the markup valid.`)}
            >
              <Icon name="sparkles" size={12} /> Rewrite
            </button>
            <button
              className="btn xs secondary"
              title="Rewrite bullets using Google's X-Y-Z formula"
              onClick={() => send(`Rewrite the selected lines ${selection.startLine}-${selection.endLine} with edit_document. Apply Google's X-Y-Z formula: open each bullet with a strong action verb (Engineered, Architected, Shipped), include a quantifiable metric, and preserve any existing macros.`)}
            >
              🎯 XYZ Formula
            </button>
            <button
              className="btn xs ghost"
              title="Fix syntax, spacing or unmatched braces in the selection"
              onClick={() => send(`Find and fix any syntax errors, unmatched braces, or broken spacing in the selected lines ${selection.startLine}-${selection.endLine} using edit_document. Change nothing else.`)}
            >
              🧹 Fix Syntax
            </button>
            <button className="btn xs ghost icon-btn" onClick={clearSelection} aria-label="Clear selection" title="Clear selection">
              <Icon name="x" size={12} />
            </button>
          </div>
        </div>
      )}

      <div className="chat-feed" ref={feedRef}>
        {showRecents ? (
          <div className="convo-list">
            <button className="btn xs primary" onClick={newChat}>
              <Icon name="plus" size={12} /> New chat
            </button>
            {recents.length === 0 && (
              <div className="muted small convo-empty">No past conversations yet. Chats save here automatically.</div>
            )}
            {recents.map((c) => (
              <div
                key={c.id}
                className={`convo-item${c.id === convId ? ' active' : ''}`}
                onClick={() => openConvo(c.id)}
                title={c.title}
              >
                <div className="convo-title">{c.title}</div>
                <div className="muted small convo-meta">
                  {c.fileName || 'document'} · {c.messages.length} msgs · {formatTimeAgo(c.updatedAt)}
                </div>
                <button
                  className="btn xs ghost icon-btn convo-del"
                  title="Delete conversation"
                  aria-label={`Delete ${c.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeConvo(c.id);
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          messages.map((m) => {
            const code = m.role === 'assistant' ? codeBlockOf(m.text) : null;
            const isLong = m.text.length > 1500;
            const open = expanded.has(m.id);
            return (
              <div key={m.id} className={`bubble ${m.role}${m.failed ? ' failed' : ''}`}>
                {m.tools && m.tools.length > 0 && (
                  <div className="tool-rows">
                    {m.tools.map((t) => (
                      <div key={t.id} className={`tool-row ${t.status}`}>
                        <span className="tool-dot" aria-hidden="true" />
                        <span className="tool-label">{t.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {m.badges && !m.tools?.length && m.badges.map((b, j) => <div key={j} className="badge">{b}</div>)}
                {m.notices?.map((n, j) => (
                  <div key={j} className="chat-notice"><Icon name="info" size={11} /> {n}</div>
                ))}

                {m.role === 'assistant' ? (
                  <div className={`bubble-text${isLong && !open ? ' clamped' : ''}`}>
                    {m.text ? <ChatMarkdown text={m.text} /> : null}
                    {m.streaming && <span className="caret" aria-hidden="true" />}
                  </div>
                ) : (
                  <div className={`bubble-text${isLong && !open ? ' clamped' : ''}`}>{m.text}</div>
                )}

                {isLong && (
                  <button className="btn xs ghost bubble-expand" onClick={() => toggleExpand(m.id)}>
                    {open ? 'Show less' : `Show more (${m.text.length} chars)`}
                  </button>
                )}

                {m.role === 'assistant' && !m.streaming && (
                  <div className="bubble-actions" style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {code !== null && (
                      <>
                        <button
                          className="btn xs secondary bubble-apply"
                          title="Replace the document with the fenced code block above (a snapshot is saved first)"
                          onClick={() => {
                            saveSnapshot(fileId ?? 'active', fileName ?? 'active-file', contentRef.current, 'Pre-apply checkpoint').catch(() => {});
                            setDocContent(code);
                            toast('Code block applied to editor — snapshot saved in History', 'success');
                          }}
                        >
                          <Icon name="bolt" size={12} /> Apply to Editor
                        </button>
                        <button
                          className="btn xs ghost"
                          title="Insert the code block at the cursor"
                          onClick={() => {
                            const ok = insertAtCursor(editorRef, code);
                            toast(ok ? 'Code inserted at cursor' : 'Place the cursor in the editor first', ok ? 'success' : 'info');
                          }}
                        >
                          <Icon name="plus" size={12} /> Insert at cursor
                        </button>
                      </>
                    )}
                    {m.text.length > 20 && (
                      <button
                        className="btn xs ghost bubble-copy"
                        title="Copy message"
                        aria-label="Copy message"
                        onClick={() => copyMessage(m.id, m.text)}
                      >
                        <Icon name={copiedIdx === m.id ? 'check' : 'copy'} size={12} /> {copiedIdx === m.id ? 'Copied' : 'Copy'}
                      </button>
                    )}
                    {m.id === lastMsg?.id && canRegenerate && (
                      <button className="btn xs ghost" title="Run the last prompt again" onClick={regenerate}>
                        <Icon name="refresh" size={12} /> Retry
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        {sending && !messages[messages.length - 1]?.text && (
          <div className="shimmer-wrap"><div className="shimmer-bar" /></div>
        )}
      </div>

      {listening && (
        <div className="voice-live" role="status">
          <span className="radar" />
          <span>Listening… speak now</span>
        </div>
      )}

      <div className="chat-input">
        <button className={`btn icon-btn ${listening ? 'rec' : ''}`} onClick={toggleVoice} title="Voice to document" aria-label="Voice input">
          <Icon name="mic" size={15} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={
            selection && selection.text
              ? `Instruct AI on lines ${selection.startLine}-${selection.endLine}…`
              : 'Ask AI to read, write, or rewrite…'
          }
          aria-label="AI prompt"
        />
        {sending ? (
          <button className="btn danger icon-btn" onClick={stop} title="Stop generating" aria-label="Stop generating">
            <Icon name="stop" size={15} />
          </button>
        ) : (
          <button className="btn primary icon-btn" onClick={() => void send()} disabled={!input.trim()} title="Send (Enter)" aria-label="Send prompt">
            <Icon name="send" size={15} />
          </button>
        )}
      </div>
      <div className="chat-hint"><kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline · select text to <strong>Ask AI</strong></div>

      {pending && (
        <DiffReviewModal
          summary={pending.summary}
          before={pending.before}
          after={pending.after}
          language={monacoLanguageFor(docMode)}
          mode={docMode}
          theme={theme}
          onAccept={(final) => {
            setDocContent(final);
            stagedRef.current = null;
            setMessages((m) => [...m, { id: nextId(), role: 'assistant', text: `✅ Accepted: ${pending.summary}` }]);
            setPending(null);
          }}
          onClose={() => {
            stagedRef.current = null;
            setPending(null);
          }}
        />
      )}

      {permReq && (
        <div className="modal-backdrop" role="dialog" aria-label="MCP permission request">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <ModalHeader icon="plug" title="Allow MCP tool call?" category="Permissions" sub={`${permReq.serverName} → ${permReq.toolName}`} onClose={() => resolvePerm('deny')} />
            <div className="modal-body">
              <pre className="perm-args">{JSON.stringify(permReq.args, null, 2).slice(0, 1500)}</pre>
            </div>
            <div className="modal-foot">
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
