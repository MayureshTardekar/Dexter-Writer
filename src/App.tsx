import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EditorPane from './components/EditorPane';
import PreviewPane, { type SourceJump } from './components/PreviewPane';
import AiPlayground, { type SelectionCtx } from './components/AiPlayground';
import ByokModal from './components/ByokModal';
import McpManager from './components/McpManager';
import LiveModal from './components/LiveModal';
import GithubPanel from './components/GithubPanel';
import ShortcutsModal from './components/ShortcutsModal';
import HistoryModal from './components/HistoryModal';
import CitationsModal from './components/CitationsModal';
import ReviewAgentModal from './components/ReviewAgentModal';
import CommandPalette, { type PaletteAction } from './components/CommandPalette';
import Toasts from './components/Toasts';
import ModalHeader from './components/ModalHeader';
import Icon from './components/icons';
import { toast } from './lib/toast';
import { type CitationEntry } from './lib/citations';
import { saveSnapshot } from './lib/history';
import { TEMPLATES, getTemplate, type DocMode } from './lib/templates';
import { getDocStats, getDocumentOutline } from './lib/docUtils';
import { resolveProvider } from './lib/aiGateway';
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
  const [provider, setProvider] = useState<string>(() => localStorage.getItem('dexter-write:provider') || 'gemini');
  const [model, setModel] = useState(() => localStorage.getItem('dexter-write:model') || 'gemini-2.0-flash');
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('dexter-write:baseUrl') || 'http://localhost:11434/v1');
  const [apiKey, setApiKey] = useState('');
  const [showByok, setShowByok] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [showGithub, setShowGithub] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCitations, setShowCitations] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [citations, setCitations] = useState<CitationEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('dexter-write:citations') || '[]');
    } catch {
      return [];
    }
  });
  type SidebarTab = 'files' | 'ai' | 'outline' | null;
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(() => {
    try {
      const raw = localStorage.getItem('dexter-write:sidebar-tab');
      return raw === 'files' || raw === 'ai' || raw === 'outline' ? raw : 'files';
    } catch {
      return 'files';
    }
  });

  const toggleSidebar = useCallback((tab: 'files' | 'ai' | 'outline') => {
    setSidebarTab((curr) => {
      const next = curr === tab ? null : tab;
      try {
        if (next) localStorage.setItem('dexter-write:sidebar-tab', next);
        else localStorage.removeItem('dexter-write:sidebar-tab');
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const [recompileSeq, setRecompileSeq] = useState(0);
  const triggerRecompile = useCallback(() => {
    setRecompileSeq((s) => s + 1);
    toast('Recompiling document…', 'info', 1500);
  }, []);

  // Dynamic layout: any pane can be maximized; side panes can be hidden
  // (center editor always stays). Persisted across reloads.
  type PaneId = 'left' | 'center' | 'right';
  const [hidden, setHidden] = useState<{ left: boolean; right: boolean }>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('dexter-write:layout') || '{}') as { hidden?: { left: boolean; right: boolean } };
      return { left: !!raw.hidden?.left, right: !!raw.hidden?.right };
    } catch {
      return { left: false, right: false };
    }
  });
  const [maximized, setMaximized] = useState<PaneId | null>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('dexter-write:layout') || '{}') as { maximized?: PaneId | null };
      return raw.maximized === 'left' || raw.maximized === 'center' || raw.maximized === 'right' ? raw.maximized : null;
    } catch {
      return null;
    }
  });
  const [leftPct, setLeftPct] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('dexter-write:layout') || '{}') as { leftPct?: number };
      return typeof raw.leftPct === 'number' ? Math.min(40, Math.max(18, raw.leftPct)) : 27;
    } catch {
      return 27;
    }
  });
  const [rightPct, setRightPct] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('dexter-write:layout') || '{}') as { rightPct?: number };
      return typeof raw.rightPct === 'number' ? Math.min(50, Math.max(22, raw.rightPct)) : 36;
    } catch {
      return 36;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('dexter-write:layout', JSON.stringify({ leftPct, rightPct, hidden, maximized }));
    } catch { /* ignore */ }
  }, [leftPct, rightPct, hidden, maximized]);

  const isVisible = (id: PaneId) => (maximized ? maximized === id : id === 'center' ? true : !hidden[id]);

  function syncMobileView(id: PaneId) {
    setMobileView(id === 'left' ? 'chat' : id === 'right' ? 'preview' : 'editor');
  }

  function toggleMax(id: PaneId) {
    setMaximized((m) => (m === id ? null : id));
    syncMobileView(id);
  }

  function applyPreset(p: 'split' | 'chat' | 'editor' | 'preview') {
    if (p === 'split') {
      setHidden({ left: false, right: false });
      setMaximized(null);
    } else {
      const id: PaneId = p === 'chat' ? 'left' : p === 'editor' ? 'center' : 'right';
      setMaximized(id);
      syncMobileView(id);
    }
  }

  function hideSide(side: 'left' | 'right') {
    setHidden((h) => ({ ...h, [side]: true }));
    if (mobileView === (side === 'left' ? 'chat' : 'preview')) setMobileView('editor');
  }

  function resetSplit() {
    setLeftPct(27);
    setRightPct(36);
  }
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'chat' | 'editor' | 'preview'>('editor');
  const [pendingImport, setPendingImport] = useState<RepoDoc[] | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  useEffect(() => {
    const up = () => {
      setOnline(true);
      toast('Back online', 'success', 2000);
    };
    const down = () => {
      setOnline(false);
      toast('Offline — local editing continues, sync paused', 'error', 3500);
    };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
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

  useEffect(() => {
    localStorage.setItem('dexter-write:citations', JSON.stringify(citations));
  }, [citations]);

  useEffect(() => {
    const timer = setInterval(() => {
      const cur = filesRef.current.find((f) => f.id === activeIdRef.current);
      if (cur && cur.content.trim()) {
        saveSnapshot(cur.id, cur.name, cur.content, 'Auto periodic checkpoint').catch(() => {});
      }
    }, 4 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const [lastSaved, setLastSaved] = useState<number | null>(null);
  useEffect(() => {
    saveProject(files, activeId);
    setLastSaved(Date.now());
  }, [files, activeId]);

  // Keep activeId valid (e.g. file deleted by a remote peer).
  useEffect(() => {
    if (files.length > 0 && !files.some((f) => f.id === activeIdRef.current)) {
      setActiveId(files[0].id);
    }
  }, [files]);

  useEffect(() => {
    const info = resolveProvider(provider);
    setModel(localStorage.getItem('dexter-write:model') || info.defaultModel);
    if (info.defaultBaseUrl && !localStorage.getItem('dexter-write:baseUrl')) {
      setBaseUrl(info.defaultBaseUrl);
    }
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

  const closeTop = useCallback(() => {
    if (pendingImport) setPendingImport(null);
    else if (showCitations) setShowCitations(false);
    else if (showHistory) setShowHistory(false);
    else if (showShortcuts) setShowShortcuts(false);
    else if (showGithub) setShowGithub(false);
    else if (showLive) setShowLive(false);
    else if (showMcp) setShowMcp(false);
    else if (showByok) setShowByok(false);
    else if (paletteOpen) setPaletteOpen(false);
  }, [pendingImport, showCitations, showHistory, showShortcuts, showGithub, showLive, showMcp, showByok, paletteOpen]);

  // Global shortcuts: palette, save-guard, Esc-to-close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        toast('Project autosaved locally', 'success', 1800);
      } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        triggerRecompile();
      } else if (e.key === 'Escape' && !paletteOpen) {
        closeTop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeTop, paletteOpen]);

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
    navigator.clipboard?.writeText(url).then(
      () => toast('Invite link copied to clipboard', 'success'),
      () => toast('Could not copy link', 'error'),
    );
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
    const info = resolveProvider(provider);
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
    setPendingImport(docs);
  }

  function confirmImportRepoFiles() {
    const docs = pendingImport;
    setPendingImport(null);
    if (!docs || docs.length === 0) return;
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
    const holder = editorRef.current as unknown as {
      _editor?: {
        revealLineInCenter: (n: number) => void;
        setPosition: (p: { lineNumber: number; column: number }) => void;
        focus: () => void;
        getModel: () => { getLineCount: () => number } | null;
        deltaDecorations: (oldIds: string[], decs: unknown[]) => string[];
      };
      _monaco?: { Range: new (...a: number[]) => unknown };
    } | null;
    try {
      const ed = holder?._editor;
      if (!ed) return;
      const total = ed.getModel()?.getLineCount() ?? Number.MAX_SAFE_INTEGER;
      const target = Math.min(Math.max(1, line), total);
      ed.revealLineInCenter(target);
      ed.setPosition({ lineNumber: target, column: 1 });
      // Flash-highlight the landed line so the eye finds it instantly.
      const monaco = holder?._monaco;
      if (monaco) {
        try {
          const ids = ed.deltaDecorations([], [{
            range: new monaco.Range(target, 1, target, 1),
            options: { isWholeLine: true, className: 'dexter-jump-line' },
          }]);
          setTimeout(() => {
            try { ed.deltaDecorations(ids, []); } catch { /* noop */ }
          }, 2600);
        } catch { /* decoration is best-effort */ }
      }
      ed.focus();
    } catch { /* noop */ }
  }

  function handleSourceJump(info: SourceJump) {
    if (docMode === 'markdown' && info.line) {
      jumpToLine(info.line);
      return;
    }
    // LaTeX / Typst previews render transformed text: fuzzy-match the
    // clicked text against original source lines instead.
    const needle = info.text.trim().replace(/\s+/g, ' ');
    if (!needle) return;
    const lines = docContent.split('\n');
    for (let len = Math.min(32, needle.length); len >= 8; len -= 6) {
      const part = needle.slice(0, len).toLowerCase();
      const idx = lines.findIndex((l) => l.toLowerCase().includes(part));
      if (idx >= 0) {
        jumpToLine(idx + 1);
        return;
      }
    }
    toast('No matching source line found', 'info', 2200);
  }

  function insertCitationTag(key: string) {
    const tag = docMode === 'latex' ? `\\cite{${key}}` : `@${key}`;
    const holder = editorRef.current as unknown as { _editor?: { getPosition: () => { lineNumber: number; column: number }; executeEdits: (src: string, ops: unknown[]) => void; focus: () => void }; _monaco?: { Range: new (...a: number[]) => unknown } } | null;
    const ed = holder?._editor;
    const monaco = holder?._monaco;
    if (ed && monaco) {
      const pos = ed.getPosition();
      const Range = monaco.Range;
      ed.executeEdits('citation', [{
        range: new Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        text: tag,
        forceMoveMarkers: true,
      }]);
      ed.focus();
    } else {
      setDocContent(docContent + (docContent.endsWith(' ') ? '' : ' ') + tag);
    }
  }

  function restoreSnapshotContent(newContent: string) {
    if (active) {
      saveSnapshot(active.id, active.name, docContent, 'Pre-restore checkpoint').catch(() => {});
    }
    setDocContent(newContent);
    const sess = liveRef.current;
    if (sess && active) sess.setContent(active.id, newContent);
  }

  const paletteActions = useMemo<PaletteAction[]>(() => {
    const acts: PaletteAction[] = [];
    if (selection && selection.text) {
      acts.push({
        id: 'ai-selection-focus',
        group: 'AI',
        label: `Edit selection (lines ${selection.startLine}-${selection.endLine}) with AI`,
        icon: 'sparkles',
        run: () => {
          setHidden((h) => ({ ...h, left: false }));
          setMobileView('chat');
        },
      });
    }
    for (const f of files) {
      acts.push({ id: `file-${f.id}`, group: 'Files', label: `Open ${f.name}`, icon: 'fileText', run: () => setActiveId(f.id) });
    }
    acts.push({
      id: 'new-file', group: 'Files', label: 'New untitled file', hint: 'md', icon: 'plus',
      run: () => {
        const name = uniqueName(filesRef.current, `untitled.${extForMode(docMode)}`);
        const f = newProjectFile(name, docMode, '');
        setFiles((prev) => [...prev, f]);
        setActiveId(f.id);
        liveRef.current?.addFile(f);
        toast(`Created ${name}`, 'success', 2000);
      },
    });
    for (const t of TEMPLATES) {
      acts.push({ id: `tpl-${t.id}`, group: 'Templates', label: `Load ${t.label}`, icon: 'template', run: () => applyTemplateToActive(t.id) });
    }
    acts.push(
      { id: 'mode-md', group: 'Document', label: 'Switch to Markdown', icon: 'fileText', run: () => switchMode('markdown') },
      { id: 'mode-tex', group: 'Document', label: 'Switch to LaTeX', icon: 'book', run: () => switchMode('latex') },
      { id: 'mode-typ', group: 'Document', label: 'Switch to Typst', icon: 'bolt', run: () => switchMode('typst') },
      { id: 'theme', group: 'View', label: `Theme: switch to ${theme === 'dark' ? 'light' : 'dark'}`, icon: theme === 'dark' ? 'sun' : 'moon', run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
      { id: 'recompile', group: 'Document', label: 'Recompile document (Ctrl+Enter)', icon: 'bolt', run: triggerRecompile },
      { id: 'tab-files', group: 'View', label: `${sidebarTab === 'files' ? 'Close' : 'Open'} project files drawer`, icon: 'files', run: () => toggleSidebar('files') },
      { id: 'tab-ai', group: 'View', label: `${sidebarTab === 'ai' ? 'Close' : 'Open'} AI assistant drawer`, icon: 'sparkles', run: () => toggleSidebar('ai') },
      { id: 'tab-outline', group: 'View', label: `${sidebarTab === 'outline' ? 'Close' : 'Open'} document outline`, icon: 'list', run: () => toggleSidebar('outline') },
      { id: 'layout-split', group: 'Layout', label: 'Split view (Editor + Preview)', icon: 'layoutSplit', run: () => applyPreset('split') },
      { id: 'layout-editor', group: 'Layout', label: 'Focus editor (Code only)', icon: 'layoutCenter', run: () => applyPreset('editor') },
      { id: 'layout-preview', group: 'Layout', label: 'Focus preview', icon: 'layoutRight', run: () => applyPreset('preview') },
    );
    acts.push(
      { id: 'open-keys', group: 'Open', label: 'API keys (BYOK vault)', icon: 'key', run: () => setShowByok(true) },
      { id: 'open-mcp', group: 'Open', label: 'External MCP servers', icon: 'plug', run: () => setShowMcp(true) },
      { id: 'open-gh', group: 'Open', label: 'GitHub sync', icon: 'github', run: () => setShowGithub(true) },
      { id: 'open-history', group: 'Open', label: 'Version history', icon: 'history', run: () => setShowHistory(true) },
      { id: 'open-cite', group: 'Open', label: 'Citation manager', icon: 'book', run: () => setShowCitations(true) },
      { id: 'open-review', group: 'Open', label: 'Autonomous Document Review Agent', icon: 'sparkles', run: () => setShowReview(true) },
      { id: 'open-keys2', group: 'Open', label: 'Keyboard shortcuts', icon: 'keyboard', run: () => setShowShortcuts(true) },
    );
    const ex: Array<{ kind: ExportKind; label: string }> = [
      { kind: 'pdf', label: 'Export PDF (print)' },
      ...(docMode === 'typst' ? [{ kind: 'typst-pdf' as ExportKind, label: 'Export Typst PDF (vector)' }] : []),
      { kind: 'tex', label: 'Export LaTeX (.tex)' },
      { kind: 'md', label: 'Export Markdown (.md)' },
      { kind: 'typ', label: 'Export Typst (.typ)' },
      { kind: 'html', label: 'Export styled HTML' },
      { kind: 'txt', label: 'Export plain text' },
      { kind: 'zip', label: `Export project ZIP (${files.length} files)` },
    ];
    for (const e of ex) {
      acts.push({
        id: `export-${e.kind}`, group: 'Export', label: e.label, icon: 'download',
        run: () => {
          if (e.kind === 'zip') exportProjectZip(filesRef.current);
          else doExport(e.kind, docContent, docMode);
          toast('Export started', 'success', 2000);
        },
      });
    }
    if (live) {
      acts.push({ id: 'invite', group: 'Live', label: 'Copy invite link', icon: 'link', run: copyInvite });
      acts.push({ id: 'leave', group: 'Live', label: `Leave room ${live.room}`, icon: 'logout', run: leaveLive });
    } else {
      acts.push({ id: 'golive', group: 'Live', label: 'Start live collaboration…', icon: 'sparkles', run: () => { setLiveError(null); setShowLive(true); } });
    }
    return acts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, docMode, docContent, theme, sidebarTab, toggleSidebar, triggerRecompile, live, maximized, hidden, selection, applyTemplateToActive, switchMode]);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark"><Icon name="bolt" size={13} /></span>
          <span className="brand-name">Dexter Write</span>
        </div>
        <div className="active-doc-badge" title="Active document and format">
          <Icon name="fileText" size={13} />
          <span>{active?.name ?? 'document'}</span>
          <div className="seg" style={{ marginLeft: 4 }}>
            <button className={docMode === 'markdown' ? 'active' : ''} onClick={() => switchMode('markdown')} title="Markdown">MD</button>
            <button className={docMode === 'latex' ? 'active' : ''} onClick={() => switchMode('latex')} title="LaTeX">LaTeX</button>
            <button className={docMode === 'typst' ? 'active' : ''} onClick={() => switchMode('typst')} title="Typst">Typst</button>
          </div>
        </div>
        <div className="spacer" />
        <div className="seg" role="group" aria-label="Layout view">
          <button
            className={maximized === 'center' ? 'active' : ''}
            onClick={() => applyPreset('editor')}
            title="Code editor only"
          >
            Code
          </button>
          <button
            className={maximized === null ? 'active' : ''}
            onClick={() => applyPreset('split')}
            title="Split view (Code + Preview)"
          >
            Split
          </button>
          <button
            className={maximized === 'right' ? 'active' : ''}
            onClick={() => applyPreset('preview')}
            title="Preview only"
          >
            Preview
          </button>
        </div>
        <button className="btn xs btn-recompile" onClick={triggerRecompile} title="Recompile document (Ctrl+Enter)">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span>Recompile</span>
        </button>
        <div className="spacer" />
        <div className="tb-group">
          <select className="tb-select" value={templateId} onChange={(e) => applyTemplateToActive(e.target.value)} aria-label="Load template into current file" title="Load template into current file">
            <option value="" disabled>Templates ▾</option>
            {TEMPLATES.filter((t) => t.mode === docMode).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <select
            className="tb-select"
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
            <option value="typst-pdf" disabled={docMode !== 'typst'}>Typst PDF (vector)</option>
            <option value="tex">LaTeX .tex</option>
            <option value="md">Markdown .md</option>
            <option value="typ">Typst .typ</option>
            <option value="html">Styled HTML</option>
            <option value="txt">Plain text</option>
            <option value="zip">Project .zip ({files.length} files)</option>
          </select>
          {live ? (
            <>
              <span className="live-badge" title={peers.map((p) => p.name).join(', ') || 'Connecting…'}>
                <span className="live-dot" />{live.room} · {peers.length || 1}
              </span>
              <button className="btn xs" onClick={copyInvite} title="Copy invite link">
                <Icon name="link" size={14} /><span className="btn-label optional">Invite</span>
              </button>
              <button className="btn xs danger" onClick={leaveLive} title="Leave live session">
                <Icon name="logout" size={14} /><span className="btn-label optional">Leave</span>
              </button>
            </>
          ) : (
            <button className="btn xs ghost icon-btn" onClick={() => { setLivePrefill({ room: '', password: '' }); setLiveError(null); setShowLive(true); }} title="Real-time P2P collaboration">
              <Icon name="sparkles" size={14} />
            </button>
          )}
          <button className="btn xs icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>
          <button className="btn xs" onClick={() => setPaletteOpen(true)} title="Command palette (Ctrl+K)">
            <Icon name="command" size={14} /><span className="btn-label optional">Ctrl+K</span>
          </button>
        </div>
      </header>

      <main className="panes" data-view={mobileView}>
        {/* Activity Bar Dock on Far Left */}
        <aside className="activity-bar" aria-label="Primary sidebar tools">
          <button
            className={`act-btn ${sidebarTab === 'files' ? 'active' : ''}`}
            onClick={() => toggleSidebar('files')}
            title="Project Files"
            aria-label="Project Files"
          >
            <Icon name="files" size={17} />
          </button>
          <button
            className={`act-btn ${sidebarTab === 'ai' ? 'active' : ''}`}
            onClick={() => toggleSidebar('ai')}
            title="AI Assistant"
            aria-label="AI Assistant"
          >
            <Icon name="sparkles" size={17} />
          </button>
          <button
            className={`act-btn ${sidebarTab === 'outline' ? 'active' : ''}`}
            onClick={() => toggleSidebar('outline')}
            title="Document Outline"
            aria-label="Document Outline"
          >
            <Icon name="list" size={17} />
          </button>

          <div className="act-spacer" />

          <button
            className="act-btn"
            onClick={() => setShowReview(true)}
            title="Autonomous Document Review Agent"
            aria-label="Document Review"
          >
            <Icon name="sparkles" size={16} />
          </button>
          <button
            className="act-btn"
            onClick={() => setShowHistory(true)}
            title="Version History & Snapshots"
            aria-label="Version History"
          >
            <Icon name="history" size={16} />
          </button>
          <button
            className="act-btn"
            onClick={() => setShowCitations(true)}
            title={`Citations${citations.length > 0 ? ` (${citations.length})` : ''}`}
            aria-label="Citations"
          >
            <Icon name="book" size={16} />
          </button>
          <button
            className="act-btn"
            onClick={() => setShowGithub(true)}
            title="GitHub Sync"
            aria-label="GitHub Sync"
          >
            <Icon name="github" size={16} />
          </button>
          <button
            className="act-btn"
            onClick={() => setShowMcp(true)}
            title={connectedCount > 0 ? `MCP Servers (${connectedCount} active)` : "External MCP Servers"}
            aria-label="External MCP"
          >
            <Icon name="plug" size={16} />
          </button>
          <button
            className="act-btn"
            onClick={() => setShowByok(true)}
            title={`AI & Vault Settings (${resolveProvider(provider).label})`}
            aria-label="AI Settings"
          >
            <Icon name="key" size={16} />
          </button>
        </aside>

        {/* Collapsible Left Drawer (Files / AI / Outline) */}
        {sidebarTab !== null && isVisible('left') && (
          <section className="pane left" style={maximized ? { flex: 1 } : { width: `${leftPct}%` }}>
            {sidebarTab === 'files' && (
              <div className="sidebar-drawer filetree-drawer">
                <div className="pane-head">
                  <span className="pane-title">Project Files ({files.length})</span>
                  <span className="pane-actions">
                    <button className="btn xs ghost icon-btn" onClick={() => toggleSidebar('files')} title="Collapse sidebar">
                      <Icon name="chevronsLeft" size={13} />
                    </button>
                  </span>
                </div>
                <div className="template-picker-row">
                  <span className="muted small">Template:</span>
                  <select
                    className="tb-select"
                    value={templateId}
                    onChange={(e) => applyTemplateToActive(e.target.value)}
                    aria-label="Load template"
                  >
                    <option value="" disabled>Select template ▾</option>
                    {TEMPLATES.filter((t) => t.mode === docMode).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                </div>
                <div className="filetree-content" style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
                  {files.map((f) => (
                    <div
                      key={f.id}
                      className={`file-item ${f.id === activeId ? 'active' : ''}`}
                      onClick={() => setActiveId(f.id)}
                      title={f.name}
                    >
                      <Icon name="fileText" size={13} className="ficon" />
                      <span className="fname">{f.name}</span>
                      <span className="fmode">{f.mode === 'markdown' ? 'md' : f.mode === 'latex' ? 'tex' : 'typ'}</span>
                      {files.length > 1 && (
                        <button
                          className="btn xs ghost icon-btn file-del"
                          title="Delete file"
                          aria-label={`Delete ${f.name}`}
                          onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
                        >
                          <Icon name="trash" size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="file-add">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addFile(); }}
                    placeholder="new-filename"
                    aria-label="New file name"
                  />
                  <select value={newMode} onChange={(e) => setNewMode(e.target.value as DocMode)} aria-label="New file type">
                    <option value="markdown">.md</option>
                    <option value="latex">.tex</option>
                    <option value="typst">.typ</option>
                  </select>
                  <button className="btn xs primary icon-btn" onClick={addFile} title="New file" aria-label="New file">
                    <Icon name="plus" size={13} />
                  </button>
                </div>
              </div>
            )}

            {sidebarTab === 'ai' && (
              <div className="sidebar-drawer ai-drawer">
                <div className="pane-head">
                  <span className="pane-title">AI Assistant</span>
                  <span className="pane-actions">
                    <span className="muted small hide-sm">{resolveProvider(provider).label}</span>
                    <button className="btn xs ghost icon-btn" onClick={() => toggleSidebar('ai')} title="Collapse sidebar">
                      <Icon name="chevronsLeft" size={13} />
                    </button>
                  </span>
                </div>
                <AiPlayground
                  docContent={docContent}
                  setDocContent={setDocContent}
                  docMode={docMode}
                  fileName={active?.name ?? ''}
                  provider={provider}
                  apiKey={apiKey}
                  model={model}
                  baseUrl={baseUrl}
                  selection={selection}
                  clearSelection={() => setSelection(null)}
                  editorRef={editorRef}
                  servers={servers}
                  theme={theme}
                  onOpenReview={() => setShowReview(true)}
                />
              </div>
            )}

            {sidebarTab === 'outline' && (
              <div className="sidebar-drawer outline-drawer">
                <div className="pane-head">
                  <span className="pane-title">Outline ({outline.length})</span>
                  <span className="pane-actions">
                    <button className="btn xs ghost icon-btn" onClick={() => toggleSidebar('outline')} title="Collapse sidebar">
                      <Icon name="chevronsLeft" size={13} />
                    </button>
                  </span>
                </div>
                <nav className="toc" aria-label="Document outline">
                  {outline.length === 0 && <span className="muted small" style={{ padding: '12px' }}>No headings found in document</span>}
                  {outline.map((o, i) => (
                    <button
                      key={i}
                      className={`toc-item l${Math.min(3, o.level)}`}
                      onClick={() => jumpToLine(o.line)}
                      title={`Jump to line ${o.line}`}
                    >
                      {o.title}
                    </button>
                  ))}
                </nav>
              </div>
            )}
          </section>
        )}

        {/* Divider when left drawer is visible */}
        {maximized === null && sidebarTab !== null && isVisible('left') && (
          <div className="divider" onMouseDown={(e) => onDragStart('left', e)} onDoubleClick={resetSplit} title="Drag to resize · double-click to reset" />
        )}

        {/* Center Pane (Editor) */}
        {isVisible('center') && (
          <section className="pane center" style={{ flex: 1 }}>
            <div className="pane-head">
              <span className="pane-title">Editor</span>
              <span className="pane-actions">
                <span className="muted small hide-sm">{docMode} · {docContent.split('\n').length} lines{live ? ` · ${live.room}` : ''}</span>
                <button className="btn xs ghost icon-btn" onClick={() => toggleMax('center')} title={maximized === 'center' ? 'Restore split view' : 'Maximize editor'}>
                  <Icon name={maximized === 'center' ? 'minimize' : 'expand'} size={13} />
                </button>
              </span>
            </div>
            <div className="filebar">
              <div className="tabs">
                {files.map((f) => (
                  <button key={f.id} className={`tab ${f.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(f.id)} title={f.name}>
                    <Icon name="fileText" size={12} className="ficon" />
                    <span className="tab-name">{f.name}</span>
                    {files.length > 1 && (
                      <span
                        className="tab-close"
                        onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
                        title={`Close ${f.name}`}
                      >
                        ×
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <button
                className="btn xs ghost icon-btn"
                style={{ margin: '4px 6px' }}
                onClick={() => {
                  const name = uniqueName(filesRef.current, `untitled.${extForMode(docMode)}`);
                  const f = newProjectFile(name, docMode, '');
                  setFiles((prev) => [...prev, f]);
                  setActiveId(f.id);
                  liveRef.current?.addFile(f);
                  toast(`Created ${name}`, 'success', 2000);
                }}
                title="New file"
              >
                <Icon name="plus" size={13} />
              </button>
            </div>
            <div className="editor-main" style={{ flex: 1, minHeight: 0 }}>
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
          </section>
        )}

        {/* Divider between Center and Right */}
        {maximized === null && isVisible('right') && (
          <div className="divider" onMouseDown={(e) => onDragStart('right', e)} onDoubleClick={resetSplit} title="Drag to resize · double-click to reset" />
        )}

        {/* Right Pane (Preview) */}
        {isVisible('right') && (
          <section className="pane right" style={maximized ? { flex: 1 } : { width: `${rightPct}%` }}>
            <div className="pane-head">
              <span className="pane-title">Preview (PDF)</span>
              <span className="pane-actions">
                <button className="btn xs ghost icon-btn" onClick={() => toggleMax('right')} title={maximized === 'right' ? 'Restore split view' : 'Maximize preview'}>
                  <Icon name={maximized === 'right' ? 'minimize' : 'expand'} size={13} />
                </button>
                <button className="btn xs ghost icon-btn" onClick={() => hideSide('right')} title="Hide preview">
                  <Icon name="chevronsRight" size={13} />
                </button>
              </span>
            </div>
            <PreviewPane
              content={docContent}
              mode={docMode}
              theme={theme}
              onSourceJump={handleSourceJump}
              compileTrigger={recompileSeq}
            />
          </section>
        )}
      </main>

      <footer className="statusbar">
        <span className="stat" title={active?.name}>{active?.name}</span>
        <span className="stat">{stats.words} words</span>
        <span className="stat hide-mobile">{stats.chars} chars</span>
        <span className="stat hide-mobile">{stats.lines} lines</span>
        <span className="stat hide-mobile">~{stats.readingTimeMin} min</span>
        <span className="stat hide-mobile" title="Autosaved to browser storage">
          <Icon name="check" size={11} /> Saved{lastSaved ? ` ${new Date(lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
        </span>
        <span className="spacer" />
        {live && (
          <span className="stat" title={peers.map((p) => p.name).join(', ')}>
            <span className="peers">
              {peers.slice(0, 4).map((p) => (
                <span key={p.clientId} className="peer" style={{ borderColor: p.color }} title={p.self ? `${p.name} (you)` : p.name}>
                  <i style={{ background: p.color }} />
                </span>
              ))}
              {live.room}
            </span>
          </span>
        )}
        <span className="stat hide-mobile">{files.length} files</span>
        {connectedCount > 0 && <span className="stat hide-mobile">MCP {connectedCount}</span>}
        <span className="stat hide-mobile">{resolveProvider(provider).label}:{model}</span>
        <span className="stat">{apiKey ? 'Key saved' : !resolveProvider(provider).needsKey ? 'Local mode' : 'No key'}</span>
        <span className="stat" title={online ? 'Online' : 'Offline — local mode'}>
          <span className={`offline-dot${online ? '' : ' off'}`} />
          {online ? 'Online' : 'Offline'}
        </span>
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
      {showHistory && (
        <HistoryModal
          fileId={active?.id || ''}
          fileName={active?.name || ''}
          currentContent={docContent}
          onRestore={restoreSnapshotContent}
          onClose={() => setShowHistory(false)}
        />
      )}
      {showCitations && (
        <CitationsModal
          citations={citations}
          onAddCitation={(c) => {
            if (!citations.some((item) => item.key === c.key)) {
              setCitations((prev) => [...prev, c]);
            }
          }}
          onRemoveCitation={(key) => setCitations((prev) => prev.filter((c) => c.key !== key))}
          onInsertCiteKey={insertCitationTag}
          docMode={docMode}
          onClose={() => setShowCitations(false)}
        />
      )}
      {showReview && (
        <ReviewAgentModal
          content={docContent}
          onApplyContent={(newContent) => {
            setDocContent(newContent);
            const sess = liveRef.current;
            if (sess && active) sess.setContent(active.id, newContent);
          }}
          mode={docMode}
          provider={provider}
          apiKey={apiKey}
          baseUrl={baseUrl}
          model={model}
          fileName={active?.name || 'document'}
          fileId={active?.id || 'active'}
          onClose={() => setShowReview(false)}
        />
      )}
      {pendingImport && (
        <div className="modal-backdrop" onClick={() => setPendingImport(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Confirm GitHub import">
            <ModalHeader icon="github" title="Replace project?" sub="Importing from GitHub replaces every file in the current project." onClose={() => setPendingImport(null)} />
            <div className="modal-body">
              <ul className="confirm-list">
                {pendingImport.slice(0, 8).map((d) => <li key={d.path}>{d.path}</li>)}
                {pendingImport.length > 8 && <li>…and {pendingImport.length - 8} more</li>}
              </ul>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setPendingImport(null)}>Keep current project</button>
              <button className="btn primary" onClick={confirmImportRepoFiles}>Replace with {pendingImport.length} files</button>
            </div>
          </div>
        </div>
      )}
      <Toasts />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
    </div>
  );
}
