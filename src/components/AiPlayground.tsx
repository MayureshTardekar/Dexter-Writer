import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { buildSystemPrompt, callLlm, detectDocMacros, type ChatHistoryItem, type ExtraToolDef, type ProviderId } from '../lib/aiGateway';
import { getDocumentOutline } from '../lib/docUtils';
import { executeVirtualTool, toolBadge, validateDocEdit, type McpToolCall } from '../lib/virtualMcp';
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
import ModalHeader from './ModalHeader';
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
  provider: ProviderId;
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

/** Extract the first fenced code block, if the message carries document code. */
function codeBlockOf(text: string): string | null {
  const match = /```(?:latex|tex|markdown|md|typst|typ)?\s*\n([\s\S]*?)```/i.exec(text);
  const code = match?.[1]?.trim();
  return code ? code : null;
}

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
    const lineCount = Math.max(1, model.getLineCount());
    if (call.name === 'replace_lines') {
      const s = Math.max(1, Math.min(Number(a.start_line ?? 1), lineCount));
      const e = Math.max(s, Math.min(Number(a.end_line ?? s), lineCount));
      const maxCol = model.getLineMaxColumn(e);
      const newText = String(a.new_text ?? a.replacement_text ?? a.text ?? '');
      editor.executeEdits('virtual-mcp-ai', [{ range: new Range(s, 1, e, maxCol), text: newText, forceMoveMarkers: true }]);
      return model.getValue();
    }
    if (call.name === 'insert_content' || call.name === 'insert_text') {
      const target = Math.max(1, Math.min(Number(a.target_line ?? 1), lineCount));
      const pos = (a.position as string) ?? 'after';
      const text = String(a.text ?? a.content ?? '');
      if (pos === 'before') {
        editor.executeEdits('virtual-mcp-ai', [{ range: new Range(target, 1, target, 1), text: text + '\n', forceMoveMarkers: true }]);
      } else {
        const maxCol = model.getLineMaxColumn(target);
        editor.executeEdits('virtual-mcp-ai', [{ range: new Range(target, maxCol, target, maxCol), text: (current ? '\n' : '') + text, forceMoveMarkers: true }]);
      }
      return model.getValue();
    }
    return current;
  } catch {
    return null;
  }
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
}: Props) {
  const GREETING: ChatMsg = {
    role: 'assistant',
    text: 'Hi! I can read, outline, insert and rewrite your document via MCP tools — plus any connected external MCP servers. Toggle Diff Review to approve edits per-chunk.',
  };
  const [initialConvos] = useState<ChatConversation[]>(() => loadConversations());
  const [convId, setConvId] = useState<string>(() => initialConvos[0]?.id ?? newConversationId());
  const [messages, setMessages] = useState<ChatMsg[]>(() => initialConvos[0]?.messages ?? [GREETING]);
  const [recents, setRecents] = useState<ChatConversation[]>(() => initialConvos);
  const [showRecents, setShowRecents] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [diffMode, setDiffMode] = useState(true);
  const [pending, setPending] = useState<{ summary: string; before: string; after: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [permReq, setPermReq] = useState<PermRequest | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  // Giant model dumps (whole documents pasted in chat) render collapsed.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  function toggleExpand(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  const permResolver = useRef<((v: 'once' | 'always' | 'deny') => void) | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef(docContent);
  contentRef.current = docContent;
  const serversRef = useRef(servers);
  serversRef.current = servers;
  // Cumulative staged content across multiple tool calls in one turn, so the
  // review modal shows ALL staged edits instead of only the last one.
  const stagedRef = useRef<string | null>(null);

  // Keep the latest message in view (but don't yank while the user scrolls up).
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom || sending) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // Autosave the conversation (debounced) so recents survive reloads.
  useEffect(() => {
    if (!messages.some((m) => m.role === 'user')) return;
    const t = window.setTimeout(() => {
      saveConversation({ id: convId, title: titleFor(messages), fileName, createdAt: Date.now(), updatedAt: Date.now(), messages });
      setRecents(loadConversations());
    }, 800);
    return () => window.clearTimeout(t);
  }, [messages, convId, fileName]);

  function openConvo(id: string) {
    const c = recents.find((r) => r.id === id);
    if (!c) return;
    setConvId(c.id);
    setMessages(c.messages.map((m) => ({ ...m })));
    setShowRecents(false);
  }

  function newChat() {
    setConvId(newConversationId());
    setMessages([{ ...GREETING }]);
    setShowRecents(false);
  }

  function removeConvo(id: string) {
    const rest = deleteConversation(id);
    setRecents(rest);
    if (id === convId) {
      setConvId(newConversationId());
      setMessages([{ ...GREETING }]);
    }
  }

  function copyMessage(i: number, text: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopiedIdx(i);
        setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1400);
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

  function stageOrApply(call: McpToolCall, badges: string[]): void {
    const cur = contentRef.current;
    saveSnapshot('active', 'active-file', cur, `Pre-AI: ${call.name}`).catch(() => {});
    // In review mode every tool call builds on the previously staged result,
    // so one Accept applies the whole turn — not just the last call.
    const base = stagedRef.current ?? cur;
    const stage = (badge: string, after: string | undefined): void => {
      if (after === undefined) return;
      stagedRef.current = after;
      setPending((prev) => ({
        summary: prev && prev.before === cur ? `${prev.summary} · ${badge}` : badge,
        before: cur,
        after,
      }));
      badges.push(`${badge} (staged)`);
    };
    if (call.name === 'insert_content' || call.name === 'insert_text') {
      const text = String(call.args.text ?? call.args.content ?? '');
      const r = strInsert(base, Number(call.args.target_line ?? 1), ((call.args.position as string) ?? 'after') as 'before' | 'after', text);
      if (diffMode) {
        stage(toolBadge(call), r.newContent);
      } else {
        const via = applyViaMonaco(editorRef, cur, call);
        const nextVal = via !== null ? via : (r.newContent !== undefined ? r.newContent : cur);
        contentRef.current = nextVal;
        setDocContent(nextVal);
        badges.push(toolBadge(call));
      }
      return;
    }
    if (call.name === 'replace_lines') {
      const newText = String(call.args.new_text ?? call.args.replacement_text ?? call.args.text ?? '');
      const r = strReplace(base, Number(call.args.start_line ?? 1), Number(call.args.end_line ?? 1), newText);
      if (diffMode) {
        stage(toolBadge(call), r.newContent);
      } else {
        const via = applyViaMonaco(editorRef, cur, call);
        const nextVal = via !== null ? via : (r.newContent !== undefined ? r.newContent : cur);
        contentRef.current = nextVal;
        setDocContent(nextVal);
        badges.push(toolBadge(call));
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
        // Validate against cumulative staged state if in review mode
        const activeContent = stagedRef.current ?? contentRef.current;
        if (tc.name.includes('insert') || tc.name.includes('replace')) {
          const problem = validateDocEdit(activeContent, { name: tc.name, args: tc.args });
          if (problem) {
            badges.push(`⚠️ ${tc.name} rejected: bad range`);
            toolResults.push(`[${tc.name} REJECTED — not applied] ${problem} Fix the arguments and retry.`);
            continue;
          }
        }
        const res = executeVirtualTool(activeContent, docMode, { name: tc.name, args: tc.args });
        if (res.resultText !== undefined) {
          badges.push(toolBadge({ name: tc.name, args: tc.args }));
          toolResults.push(`[${tc.name} result]\n${res.resultText.slice(0, 2500)}`);
        } else if (res.newContent !== undefined || tc.name.includes('insert') || tc.name.includes('replace')) {
          stageOrApply({ name: tc.name, args: tc.args }, badges);
          toolResults.push(`[${tc.name}] ${res.message}${diffMode ? ' (staged for user diff review)' : ' (applied to editor)'}`);
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
    stagedRef.current = null; // fresh staging base for this turn
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
      // Template-detected macros: reuse what the doc defines, never invent calls.
      const detected = detectDocMacros(contentRef.current, docMode);
      const macroHint = detected.length > 0
        ? `- Custom macros defined in THIS document (reuse them; NEVER emit a macro call that is not defined here or in standard LaTeX): ${detected.map((m) => `\\${m}`).join(', ')}`
        : `- The document defines no custom macros — use only standard LaTeX commands and the environments already present. NEVER invent macros like \\resumeItem or \\resumeSubheading.`;
      // Selection bias: when text is selected, edits belong to that range.
      const selHint = selection
        ? `- The user selected lines ${selection.startLine}-${selection.endLine}. If this is an EDIT request, operate on that range with replace_lines. If it is a QUESTION, just answer — no tools.`
        : '';
      const system = buildSystemPrompt(docMode, outlineText, contentRef.current, externalHint, fileName, `${macroHint}\n${selHint}`);
      const history: ChatHistoryItem[] = messages.slice(-8).map((m) => ({ role: m.role, text: m.text.slice(0, 2000) }));

      const badges: string[] = [];
      const toolResults: string[] = [];
      let finalText = '';
      let convHistory = [...history];
      let nextPrompt = userText;

      const MAX_ROUNDS = 3;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const turn = await callLlm(provider, { apiKey, baseUrl, model }, system, convHistory, nextPrompt, extra);
        if (turn.text) finalText = turn.text;

        if (!turn.toolCalls || turn.toolCalls.length === 0) {
          break;
        }

        const roundToolResults: string[] = [];
        await runToolCalls(turn.toolCalls, defs, badges, roundToolResults);
        toolResults.push(...roundToolResults);

        if (roundToolResults.length === 0) {
          break;
        }

        // Feed tool results back to model for follow-up edits, recovery, or concise summary
        convHistory = [
          ...convHistory,
          { role: 'user', text: nextPrompt },
          { role: 'assistant', text: turn.text || `Executing tools: ${turn.toolCalls.map((c) => c.name).join(', ')}` },
        ];
        nextPrompt = `Tool execution results:\n${roundToolResults.join('\n\n')}\n\nContinue with document edits if required, or provide a concise summary with exact line numbers. ${
          diffMode ? 'Document edits are staged for user review.' : 'Edits have been applied to the document.'
        }`;
      }

      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: finalText || (badges.length ? 'Done — see tool activity badges above.' : 'No changes made.'),
          badges,
        },
      ]);
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
        {fileName && (
          <span className="ai-file-pill" title={`Target active file: ${fileName} (${docMode})`}>
            <Icon name="fileText" size={11} /> {fileName}
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
              title="Surgically rewrite selected lines"
              onClick={() => send(`Rewrite selected lines ${selection.startLine}-${selection.endLine} using replace_lines. Make it concise, punchy, and keep LaTeX syntax valid.`)}
            >
              <Icon name="sparkles" size={12} /> Rewrite
            </button>
            <button
              className="btn xs secondary"
              title="Rewrite bullets using Google's X-Y-Z formula (Accomplished X by doing Y resulting in Z)"
              onClick={() => send(`Rewrite selected lines ${selection.startLine}-${selection.endLine} using replace_lines. Apply Google's XYZ formula: start each bullet with a strong action verb (Engineered, Architected, Shipped), include quantifiable metrics, and preserve LaTeX macros.`)}
            >
              🎯 XYZ Formula
            </button>
            <button
              className="btn xs ghost"
              title="Fix syntax errors, spacing, or unmatched braces in selection"
              onClick={() => send(`Check and fix any LaTeX syntax, unmatched braces, spacing, or formatting errors in selected lines ${selection.startLine}-${selection.endLine} using replace_lines.`)}
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
          <>
            {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.badges?.map((b, j) => <div key={j} className="badge">{b}</div>)}
            <div className={`bubble-text${m.text.length > 1500 && !expanded.has(i) ? ' clamped' : ''}`}>{m.text}</div>
            {m.text.length > 1500 && (
              <button className="btn xs ghost bubble-expand" onClick={() => toggleExpand(i)}>
                {expanded.has(i) ? 'Show less' : `Show more (${m.text.length} chars)`}
              </button>
            )}
            {m.role === 'assistant' && (
              <div className="bubble-actions" style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
                {codeBlockOf(m.text) !== null && (
                  <button
                    className="btn xs secondary bubble-apply"
                    title="Replace the document with the fenced code block above (a snapshot is saved first)"
                    onClick={() => {
                      const code = codeBlockOf(m.text);
                      if (!code) return;
                      saveSnapshot('active', 'active-file', contentRef.current, 'Pre-apply checkpoint').catch(() => {});
                      setDocContent(code);
                      toast('Code block applied to editor — snapshot saved in History', 'success');
                    }}
                  >
                    <Icon name="bolt" size={12} /> Apply code to Editor
                  </button>
                )}
                {m.text.length > 20 && (
                  <button
                    className="btn xs ghost bubble-copy"
                    title="Copy message"
                    aria-label="Copy message"
                    onClick={() => copyMessage(i, m.text)}
                  >
                    <Icon name={copiedIdx === i ? 'check' : 'copy'} size={12} /> {copiedIdx === i ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="bubble assistant">
            <div className="shimmer-wrap"><div className="shimmer-bar" /></div>
            <div className="bubble-text typing">Thinking + running MCP tools</div>
          </div>
        )}
          </>
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
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={
            selection && selection.text
              ? `Instruct AI on lines ${selection.startLine}-${selection.endLine} (or click an action above)...`
              : 'Ask AI to read, write, or rewrite…'
          }
          aria-label="AI prompt"
        />
        <button className="btn primary icon-btn" onClick={() => send()} disabled={sending || !input.trim()} title="Send (Enter)" aria-label="Send prompt">
          <Icon name="send" size={15} />
        </button>
      </div>
      <div className="chat-hint"><kbd>Enter</kbd> send · <kbd>Ctrl+Enter</kbd> newline · select text to <strong>Ask AI</strong></div>
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
            setMessages((m) => [...m, { role: 'assistant', text: `✅ Accepted: ${pending.summary}` }]);
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
