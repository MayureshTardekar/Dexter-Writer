import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EditorPane from './components/EditorPane';
import PreviewPane from './components/PreviewPane';
import AiPlayground, { type SelectionCtx } from './components/AiPlayground';
import ByokModal from './components/ByokModal';
import McpManager from './components/McpManager';
import LiveModal from './components/LiveModal';
import GithubPanel from './components/GithubPanel';
import ShortcutsModal from './components/ShortcutsModal';
import { TEMPLATES, getTemplate, type DocMode } from './lib/templates';
import { getDocStats, getDocumentOutline } from './lib/docUtils';
import { PROVIDERS, type ProviderId } from './lib/aiGateway';
import { vaultGet, vaultSet } from './lib/vault';
import { doExport, exportProjectZip, type ExportKind } from './lib/exportDoc';
import { loadServers, saveServers, type ExternalMcpServer } from './lib/externalMcp';
import {
  extForMode,
  loadProject,
  modeForName,
  newProjectFile,
  saveProject,
  uniqueName,
  type ProjectFile,
} from './lib/projectFiles';
import { warmupTypstEngine } from './lib/typstEngine';
import {
  clearRoomHash,
  getSelfName,
  parseRoomHash,
  setSelfName,
  startCollab,
  writeRoomHash,
  type CollabPeer,
  type CollabSession,
  type FileMeta,
} from './lib/collab';
import type { RepoDoc } from './lib/github';

const LS_THEME = 'dexter-write:theme';

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem(LS_THEME) as 'dark' | 'light') || 'dark');
  const [files, setFiles] = useState<ProjectFile[]>(() => loadProject().files);
  const [activeId, setActiveId] = useState<string>(() => loadProject().activeId);
  const [templateId, setTemplateId] = useState('resume-md');
  const [provider, setProvider] = useState<ProviderId>(() => (localStorage.getItem('dexter-write:provider') as ProviderId) || 'gemini');
  const [model, setModel] = useState(() => localStorage.getItem('dexter-write:model') || 'gemini-2.0-flash');
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('dexter-write:baseUrl') || 'http://localhost:11434/v1');
  const [apiKey, setApiKey] = useState('');
  const [showByok, setShowByok] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [showGithub, setShowGithub] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showToc, setShowToc] = useState(true);
  const [showFiles, setShowFiles] = useState(true);
  const [zen, setZen] = useState<'none' | 'editor' | 'preview'>('none');
  const [leftPct, setLeftPct] = useState(27);
  const [rightPct, setRightPct] = useState(36);
  const [selection, setSelection] = useState<SelectionCtx | null>(null);
  const [servers, setServersState] = useState<ExternalMcpServer[]>(() => loadServers());
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<DocMode>('markdown');
  // Phase 3: live collaboration
  const [live, setLive] = useState<CollabSession | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [showLive, setShowLive] = useState(false);
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [livePrefill, setLivePrefill] = useState({ room: '', password: '' });
  const editorRef = useRef<unknown>(null);
  const dragRef = useRef<{ kind: 'left' | 'right'; startX: number; startL: number; startR: number } | null>(null);

  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const filesRef = useRef(files);
  filesRef.current = files;
  const liveRef = useRef(live);
  liveRef.current = live;

  const active = files.find((f) => f.id === activeId) ?? files[0];
  const docContent = active?.content ?? '';
  const docMode = active?.mode ?? 'markdown';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(LS_THEME, theme);
  }, [theme]);

  useEffect(() => { saveProject(files, activeId); }, [files, activeId]);

  // Keep activeId valid (e.g. file deleted by a remote peer).
  useEffect(() => {
    if (files.length > 0 && !files.some((f) => f.id === activeIdRef.current)) {
      setActiveId(files[0].id);
    }
  }, [files]);

  useEffect(() => {
    const info = PROVIDERS.find((p) => p.id === provider)!;
    setModel(localStorage.getItem('dexter-write:model') || info.defaultModel);
    vaultGet(info.keyName).then((k) => setApiKey(k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  // Auto-join invite links (#room=…).
  useEffect(() => {
    const parsed = parseRoomHash();
    if (parsed && !liveRef.current) {
      setLivePrefill({ room: parsed.room, password: parsed.password });
      void joinLive(parsed.room, parsed.password, getSelfName(), filesRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tear down collab on unmount.
  useEffect(() => {
    return () => { try { liveRef.current?.destroy(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => getDocStats(docContent), [docContent]);
  const outline = useMemo(() => getDocumentOutline(docContent, docMode), [docContent, docMode]);
  const connectedCount = useMemo(() => servers.filter((s) => s.enabled && s.status === 'connected').length, [servers]);

  const setServers = useCallback((s: ExternalMcpServer[]) => {
    setServersState(s);
    saveServers(s);
  }, []);

  // Live-aware content writer: through Y when live (equality-guarded, loop-free).
  const setDocContent = useCallback((v: string) => {
    const sess = liveRef.current;
    const id = activeIdRef.current;
    if (sess) {
      sess.setContent(id, v);
      // Optimistic local echo is unnecessary — binding/onChange converges.
      // But when the editor isn't bound yet (switching), fall back to state.
      setFiles((prev) => {
        const cur = prev.find((f) => f.id === id);
        if (!cur) return prev;
        const yt = sess.getYText(id);
        if (yt && yt.toString() !== v) return prev; // Y owns it now; onChange will echo.
        if (cur.content === v) return prev;
        return prev.map((f) => (f.id === id ? { ...f, content: v, updatedAt: Date.now() } : f));
      });
      return;
    }
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, content: v, updatedAt: Date.now() } : f)));
  }, []);

  async function joinLive(room: string, password: string, name: string, base: ProjectFile[]) {
    if (liveRef.current) return;
    setLiveBusy(true);
    setLiveError(null);
    try {
      setSelfName(name);
      const sess = await startCollab(room, password, base, name, {
        onFiles: (incoming) => {
          setFiles(incoming);
        },
        onPeers: (p) => setPeers(p),
      });
      setLive(sess);
      writeRoomHash(room, password);
      setShowLive(false);
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : String(e));
      setLivePrefill({ room, password });
      setShowLive(true);
    } finally {
      setLiveBusy(false);
    }
  }

  function leaveLive() {
    try { liveRef.current?.destroy(); } catch { /* noop */ }
    setLive(null);
    setPeers([]);
    clearRoomHash();
  }

  function copyInvite() {
    const s = liveRef.current;
    if (!s) return;
    // Rebuild from current hash (holds room + key).
    const h = window.location.hash.replace(/^#/, '');
    const url = `${window.location.origin}${window.location.pathname}#${h || `room=${encodeURIComponent(s.room)}`}`;
    navigator.clipboard?.writeText(url).catch(() => {});
  }

  const applyTemplateToActive = useCallback((id: string) => {
    setTemplateId(id);
    const t = getTemplate(id);
    const aid = activeIdRef.current;
    const sess = liveRef.current;
    setFiles((prev) => prev.map((f) => {
      if (f.id !== aid) return f;
      const dot = f.name.lastIndexOf('.');
      const stem = dot > 0 ? f.name.slice(0, dot) : f.name;
      const name = `${stem}.${extForMode(t.mode)}`;
      sess?.setMeta(aid, { name, mode: t.mode } satisfies FileMeta);
      return { ...f, content: t.content, mode: t.mode, name, updatedAt: Date.now() };
    }));
    const cur = filesRef.current.find((f) => f.id === aid);
    if (sess && cur) sess.setContent(aid, t.content);
    if (t.mode === 'typst') warmupTypstEngine();
  }, []);

  const switchMode = useCallback((m: DocMode) => {
    const aid = activeIdRef.current;
    const sess = liveRef.current;
    setFiles((prev) => prev.map((f) => {
      if (f.id !== aid) return f;
      const dot = f.name.lastIndexOf('.');
      const stem = dot > 0 ? f.name.slice(0, dot) : f.name;
      const name = `${stem}.${extForMode(m)}`;
      sess?.setMeta(aid, { name, mode: m } satisfies FileMeta);
      return { ...f, mode: m, name, updatedAt: Date.now() };
    }));
    if (m === 'typst') warmupTypstEngine();
  }, []);

  const saveKey = useCallback(async (k: string) => {
    const info = PROVIDERS.find((p) => p.id === provider)!;
    await vaultSet(info.keyName, k);
  }, [provider]);

  function addFile() {
    const raw = newName.trim() || `untitled.${extForMode(newMode)}`;
    const withExt = raw.includes('.') ? raw : `${raw}.${extForMode(newMode)}`;
    const name = uniqueName(filesRef.current, withExt);
    const mode = raw.includes('.') ? modeForName(name) : newMode;
    const f = newProjectFile(name, mode, '');
    setFiles((prev) => [...prev, f]);
    setActiveId(f.id);
    setNewName('');
    liveRef.current?.addFile(f);
    if (mode === 'typst') warmupTypstEngine();
  }

  function removeFile(id: string) {
    if (filesRef.current.length <= 1) return;
    liveRef.current?.removeFile(id);
    const idx = filesRef.current.findIndex((f) => f.id === id);
    const next = filesRef.current.filter((f) => f.id !== id);
    setFiles(next);
    if (id === activeIdRef.current) setActiveId(next[Math.max(0, idx - 1)].id);
  }

  function importRepoFiles(docs: RepoDoc[]) {
    if (docs.length === 0) return;
    if (!window.confirm(`Replace current project with ${docs.length} file(s) from GitHub?`)) return;
    const now = Date.now();
    // Build fresh project from repo docs
    const incoming: ProjectFile[] = docs.map((d, i) => ({
      id: `gh_${now.toString(36)}_${i}`,
      name: d.path,
      mode: modeForName(d.path),
      content: d.content,
      updatedAt: now,
    }));
    const sess = liveRef.current;
    if (sess) {
      // Replace shared state: remove old, add new
      for (const f of filesRef.current) sess.removeFile(f.id);
      for (const f of incoming) sess.addFile(f);
    }
    setFiles(incoming);
    setActiveId(incoming[0].id);
  }

  function onDragStart(kind: 'left' | 'right', e: React.MouseEvent) {
    dragRef.current = { kind, startX: e.clientX, startL: leftPct, startR: rightPct };
    const move = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const total = window.innerWidth || 1200;
      const dxPct = ((ev.clientX - d.startX) / total) * 100;
      if (d.kind === 'left') setLeftPct(Math.min(40, Math.max(18, d.startL + dxPct)));
      else setRightPct(Math.min(50, Math.max(22, d.startR - dxPct)));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function jumpToLine(line: number) {
    const holder = editorRef.current as unknown as { _editor?: { revealLineInCenter: (n: number) => void; setPosition: (p: { lineNumber: number; column: number }) => void; focus: () => void } } | null;
    try {
      holder?._editor?.revealLineInCenter(line);
      holder?._editor?.setPosition({ lineNumber: line, column: 1 });
      holder?._editor?.focus();
    } catch { /* noop */ }
  }

  const keyStatus = apiKey ? '●' : '○';

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">⚡ Dexter Write</div>
        <button className="btn xs" onClick={() => setShowFiles(!showFiles)} title="File tree">📁 {files.length}</button>
        <select value={templateId} onChange={(e) => applyTemplateToActive(e.target.value)} aria-label="Load template into current file" title="Load template into current file">
          {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <div className="seg">
          <button className={docMode === 'markdown' ? 'active' : ''} onClick={() => switchMode('markdown')}>MD</button>
          <button className={docMode === 'latex' ? 'active' : ''} onClick={() => switchMode('latex')}>LaTeX</button>
          <button className={docMode === 'typst' ? 'active' : ''} onClick={() => switchMode('typst')}>Typst</button>
        </div>
        <div className="spacer" />
        {live ? (
          <>
            <span className="live-badge" title={peers.map((p) => p.name).join(', ') || 'Connecting…'}>
              🟢 {live.room} · {peers.length || 1}
            </span>
            <button className="btn xs" onClick={copyInvite} title="Copy invite link">🔗 Invite</button>
            <button className="btn xs danger" onClick={leaveLive} title="Leave live session">Leave</button>
          </>
        ) : (
          <button className="btn xs" onClick={() => { setLivePrefill({ room: '', password: '' }); setLiveError(null); setShowLive(true); }} title="Real-time P2P collaboration">🤝 Go Live</button>
        )}
        <button className="btn xs" onClick={() => setShowGithub(true)} title="GitHub sync">🐙</button>
        <button className="btn xs" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts & help">⌨️</button>
        <button className="btn xs" onClick={() => setShowToc(!showToc)} title="Table of contents">TOC</button>
        <button className="btn xs" onClick={() => setZen(zen === 'editor' ? 'none' : 'editor')}>Zen</button>
        <button className="btn xs" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀️' : '🌙'}</button>
        <button className="btn xs" onClick={() => setShowMcp(true)} title="External MCP servers">🔌{connectedCount > 0 ? ` ${connectedCount}` : ''}</button>
        <button className="btn xs" onClick={() => setShowByok(true)} title="BYOK settings">🔑 {keyStatus} {provider}</button>
        <select
          aria-label="Export"
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value as ExportKind | '';
            e.target.value = '';
            if (!v) return;
            if (v === 'zip') exportProjectZip(files);
            else doExport(v, docContent, docMode);
          }}
        >
          <option value="" disabled>Export ▾</option>
          <option value="pdf">PDF (print)</option>
          <option value="typst-pdf" disabled={docMode !== 'typst'}>Typst PDF (vector ⚡)</option>
          <option value="tex">LaTeX .tex</option>
          <option value="md">Markdown .md</option>
          <option value="typ">Typst .typ</option>
          <option value="html">Styled HTML</option>
          <option value="txt">Plain text</option>
          <option value="zip">Project .zip ({files.length} files)</option>
        </select>
      </header>

      <main className="panes">
        {zen === 'none' && (
          <section className="pane left" style={{ width: `${leftPct}%` }}>
            <div className="pane-head">AI Playground <span className="muted small">{PROVIDERS.find((p) => p.id === provider)?.label}</span></div>
            <AiPlayground
              docContent={docContent}
              setDocContent={setDocContent}
              docMode={docMode}
              provider={provider}
              apiKey={apiKey}
              model={model}
              baseUrl={baseUrl}
              selection={selection}
              clearSelection={() => setSelection(null)}
              editorRef={editorRef}
              servers={servers}
              theme={theme}
            />
          </section>
        )}
        {zen === 'none' && <div className="divider" onMouseDown={(e) => onDragStart('left', e)} />}

        {(zen === 'none' || zen === 'editor') && (
          <section className="pane center" style={{ flex: 1 }}>
            <div className="pane-head">
              <span>Editor <span className="muted small">{docMode} · {docContent.split('\n').length} lines</span></span>
              {live && (
                <span className="peers">
                  {peers.map((p) => (
                    <span key={p.clientId} className="peer" style={{ borderColor: p.color }} title={p.self ? `${p.name} (you)` : p.name}>
                      <i style={{ background: p.color }} />{p.name}{p.self ? ' (you)' : ''}
                    </span>
                  ))}
                </span>
              )}
            </div>
            {showFiles && (
              <div className="filebar">
                <div className="tabs">
                  {files.map((f) => (
                    <button key={f.id} className={`tab ${f.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(f.id)} title={f.name}>
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="editor-row">
              {showFiles && (
                <aside className="filetree">
                  {files.map((f) => (
                    <div key={f.id} className={`file-item ${f.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(f.id)}>
                      <span className="fname">{f.name}</span>
                      <span className="muted small">{f.mode}</span>
                      {files.length > 1 && (
                        <button
                          className="btn xs ghost"
                          title="Delete file"
                          onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="file-add">
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="new-file" aria-label="New file name" />
                    <select value={newMode} onChange={(e) => setNewMode(e.target.value as DocMode)} aria-label="New file type">
                      <option value="markdown">.md</option>
                      <option value="latex">.tex</option>
                      <option value="typst">.typ</option>
                    </select>
                    <button className="btn xs primary" onClick={addFile}>+</button>
                  </div>
                </aside>
              )}
              <div className="editor-main">
                <EditorPane
                  key={live ? `live-${live.room}-${active?.id}` : `local-${active?.id}`}
                  value={docContent}
                  mode={docMode}
                  theme={theme}
                  onChange={setDocContent}
                  onSelection={(text, startLine, endLine) => setSelection({ text, startLine, endLine })}
                  editorRef={editorRef}
                  collab={live && active ? { session: live, fileId: active.id } : null}
                />
              </div>
            </div>
          </section>
        )}
        {zen === 'none' && <div className="divider" onMouseDown={(e) => onDragStart('right', e)} />}

        {(zen === 'none' || zen === 'preview') && (
          <section className="pane right" style={zen === 'preview' ? { flex: 1 } : { width: `${rightPct}%` }}>
            <div className="pane-head">
              Preview
              <button className="btn xs ghost" onClick={() => setZen(zen === 'preview' ? 'none' : 'preview')}>{zen === 'preview' ? 'Exit' : 'Expand'}</button>
            </div>
            {showToc && (
              <nav className="toc" aria-label="Document outline">
                {outline.length === 0 && <span className="muted small">No headings yet</span>}
                {outline.map((o, i) => (
                  <button key={i} className={`toc-item l${o.level}`} onClick={() => jumpToLine(o.line)} title={`Go to line ${o.line}`}>
                    {o.title}
                  </button>
                ))}
              </nav>
            )}
            <PreviewPane content={docContent} mode={docMode} />
          </section>
        )}
      </main>

      <footer className="statusbar">
        <span>📄 {active?.name}</span><span>{stats.words} words</span><span>{stats.chars} chars</span><span>{stats.lines} lines</span><span>~{stats.readingTimeMin} min read</span>
        <span className="spacer" />
        {live && <span>🟢 {live.room}</span>}
        <span>{files.length} files</span>
        <span>{connectedCount > 0 ? `🔌 ${connectedCount} MCP` : ''}</span>
        <span>{provider}:{model}</span>
        <span>{apiKey ? '🔑 key saved' : provider === 'ollama' ? 'local mode' : 'no key'}</span>
        <span>Ctrl+S saved locally · Ctrl+Z undoes AI edits</span>
      </footer>

      {showByok && (
        <ByokModal
          provider={provider}
          setProvider={setProvider}
          model={model}
          setModel={setModel}
          baseUrl={baseUrl}
          setBaseUrl={setBaseUrl}
          apiKey={apiKey}
          setApiKey={setApiKey}
          saveKey={saveKey}
          onClose={() => setShowByok(false)}
        />
      )}
      {showMcp && (
        <McpManager servers={servers} setServers={setServers} onClose={() => setShowMcp(false)} />
      )}
      {showLive && !live && (
        <LiveModal
          initialRoom={livePrefill.room}
          initialPassword={livePrefill.password}
          initialName={getSelfName()}
          busy={liveBusy}
          error={liveError}
          onJoin={(room, pw, name) => joinLive(room, pw, name, filesRef.current)}
          onClose={() => setShowLive(false)}
        />
      )}
      {showGithub && (
        <GithubPanel files={files} onImportFiles={importRepoFiles} onClose={() => setShowGithub(false)} />
      )}
      {showShortcuts && (
        <ShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}
    </div>
  );
}
