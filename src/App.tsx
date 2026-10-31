import { persistAiAction, readAiAction, removeAiAction } from './lib/aiActions';
import ProjectFileTree from './components/ProjectFileTree';
import AssetLibraryModal from './components/AssetLibraryModal';
import ProjectHubModal from './components/ProjectHubModal';
import CloudPanel from './components/CloudPanel';
import { ProjectContext, compileLatexProject, compileTypstProject, type ProjectRuntime } from './lib/projectRuntime';
import { listAssets, storeAsset, removeAsset, prepareAsset, imageSnippet, type ProjectAsset, type ImageOptions } from './lib/assets';
import { projectPath, resolveProjectPath, relativeProjectPath } from './lib/projectPaths';
import { documentReferences, validateProject } from './lib/validateProject';
import type { ImportedProject } from './lib/importProject';
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
import DiffReviewModal from './components/DiffReviewModal';
import ExternalAgentBanner from './components/ExternalAgentBanner';
import CommandPalette, { type PaletteAction } from './components/CommandPalette';
import Toasts from './components/Toasts';
import DialogHost from './components/DialogHost';
import ModalHeader from './components/ModalHeader';
import Icon from './components/icons';
import { toast } from './lib/toast';
import { askConfirm, askPrompt } from './lib/dialog';
import { type CitationEntry } from './lib/citations';
import { saveSnapshot } from './lib/history';
import { TEMPLATES, getTemplate, type DocMode } from './lib/templates';
import { getDocStats, getDocumentOutline } from './lib/docUtils';
import { resolveProvider } from './lib/aiGateway';
import type { FileAccess } from './lib/agent';
import {
  clearUndoAction,
  createWorkspace,
  describeConflicts,
  findUndoConflicts,
  findWorkspaceConflicts,
  loadUndoAction,
  workspaceSummary,
  type AppliedAiAction,
  type AppliedWorkspaceFile,
  type StagedWorkspace,
  type WorkspaceApplyResult,
} from './lib/aiWorkspace';
import { vaultGet, vaultSet } from './lib/vault';
import { doExport, exportProjectZip, type ExportKind } from './lib/exportDoc';
import { loadServers, saveServers, type ExternalMcpServer } from './lib/externalMcp';
import { fetchCloudFiles, listCloudFileMeta } from './lib/cloud/cloudStore';
import { cloudConfigured } from './lib/cloud/supabase';
import {
  changedFiles,
  clearCloudBaseline,
  contentHash,
  loadCloudBaseline,
  makeBaseline,
  matchesBaseline,
  saveCloudBaseline,
  type CloudSyncBaseline,
} from './lib/cloud/remoteSync';
import {
  McpBridgeClient,
  type BridgeAccess,
  type BridgeCompileOutcome,
  type BridgeDiagnosticsOutcome,
  type BridgeMutationOutcome,
  type BridgeStatus,
} from './lib/mcp/bridgeClient';
import {
  resolveExternalTarget,
  stageExternalInsertion,
  stageExternalStringEdit,
} from './lib/mcp/externalEdits';
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
const LS_CLOUD_PROJECT = 'dexter-write:cloud-project-id';

function newAiActionId(): string {
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem(LS_THEME) as 'dark' | 'light') || 'dark');
  const [initialProject] = useState(loadProject);
  const [files, setFiles] = useState<ProjectFile[]>(initialProject.files);
  const [activeId, setActiveId] = useState<string>(initialProject.activeId);
  const [provider, setProvider] = useState<string>(() => localStorage.getItem('dexter-write:provider') || 'gemini');
  const [model, setModel] = useState(() => localStorage.getItem('dexter-write:model') || '');
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('dexter-write:baseUrl') || 'http://localhost:11434/v1');
  const [apiKey, setApiKey] = useState('');
  const [projectId] = useState(() => { const existing = localStorage.getItem('dexter-write:project-id'); if (existing) return existing; const id = crypto.randomUUID(); localStorage.setItem('dexter-write:project-id', id); return id; });
  const [cloudProjectId, setCloudProjectId] = useState(() => {
    try { return localStorage.getItem(LS_CLOUD_PROJECT) || ''; } catch { return ''; }
  });
  const [cloudLinkEpoch, setCloudLinkEpoch] = useState(0);
  const cloudBaselineRef = useRef<CloudSyncBaseline>(cloudProjectId ? loadCloudBaseline(cloudProjectId) : {});
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [sharedAssetIds, setSharedAssetIds] = useState<string[]>([]);
  const [showAssets, setShowAssets] = useState(false);
  const [showHub, setShowHub] = useState(() => localStorage.getItem('dexter-write:started') !== '1');
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saving');
  const [saveError, setSaveError] = useState('');
  const [validationStatus, setValidationStatus] = useState('Draft');
  useEffect(() => { listAssets(projectId).then(setAssets).catch((e) => toast(`Images could not be loaded: ${String(e)}`, 'error', 7000)); }, [projectId]);
  useEffect(() => {
    const urls = Object.fromEntries(assets.map((a) => [a.path, URL.createObjectURL(a.blob)]));
    setAssetUrls(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [assets]);
  // Ghost-text completion is opt-in: it spends an API call per typing pause,
  // which matters on a free tier. See AI_AGENT_ROADMAP.md §10.
  const [aiComplete, setAiComplete] = useState(() => localStorage.getItem('dexter-write:ai-complete') === '1');
  const [showByok, setShowByok] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [showCloud, setShowCloud] = useState(false);
  const [mcpBridgeEnabled, setMcpBridgeEnabled] = useState(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem('dexter-write:mcp-bridge-enabled'); } catch { stored = null; }
    if (stored === '1') return true;
    if (stored === '0') return false;
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  });
  const [mcpBridgeStatus, setMcpBridgeStatus] = useState<BridgeStatus>('off');
  const [externalApplied, setExternalApplied] = useState<{ action: AppliedAiAction; summary: string; count: number } | null>(null);
  const applyAiWorkspaceRef = useRef<((workspace: StagedWorkspace) => WorkspaceApplyResult) | null>(null);
  const lastCompileRef = useRef<BridgeCompileOutcome | null>(null);
  const [showGithub, setShowGithub] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCitations, setShowCitations] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [aiFixProposal, setAiFixProposal] = useState<{ summary: string; before: string; after: string } | null>(null);
  const [undoAction, setUndoAction] = useState<AppliedAiAction | null>(null);
  const undoVersionRef = useRef(0);
  useEffect(() => {
    let mounted = true; const version = undoVersionRef.current;
    readAiAction(projectId).then((action) => { if (mounted && version === undoVersionRef.current) setUndoAction(action || loadUndoAction()); }).catch((e) => toast(`Undo history could not be loaded: ${String(e)}`, 'error'));
    return () => { mounted = false; };
  }, [projectId]);
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

  function showMobileView(view: 'chat' | 'editor' | 'preview') {
    if (view === 'chat' && !sidebarTab) setSidebarTab('files');
    if (view === 'chat') setHidden((h) => ({ ...h, left: false }));
    applyPreset(view);
  }

  function openToolPanel(tab: 'files' | 'ai' | 'outline') {
    const opening = sidebarTab !== tab;
    toggleSidebar(tab);
    if (opening) {
      if (window.matchMedia('(max-width: 920px)').matches) applyPreset('chat');
      else setHidden((h) => ({ ...h, left: false }));
    } else if (mobileView === 'chat') {
      setMaximized('center');
      setMobileView('editor');
    }
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
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const liveRef = useRef(live);
  liveRef.current = live;

  const linkCloudProject = useCallback((nextProjectId: string) => {
    if (!nextProjectId) return;
    try { localStorage.setItem(LS_CLOUD_PROJECT, nextProjectId); } catch { /* storage disabled */ }
    setCloudProjectId(nextProjectId);
    setCloudLinkEpoch((epoch) => epoch + 1);
  }, []);

  const active = files.find((f) => f.id === activeId) ?? files[0];
  const docContent = active?.content ?? '';
  const docMode: DocMode = active ? (modeForName(active.name) || active.mode || 'markdown') : 'markdown';
  const runtime = useMemo<ProjectRuntime>(() => ({ files, assets, urls: assetUrls, activeName: active?.name || 'main.md', revision: assets.reduce((n, a) => n + a.updatedAt, 0) }), [files, assets, assetUrls, active?.name]);
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  useEffect(() => setValidationStatus('Draft'), [files, assets]);

  useEffect(() => {
    localStorage.setItem('dexter-write:mcp-bridge-enabled', mcpBridgeEnabled ? '1' : '0');
    if (!mcpBridgeEnabled) {
      setMcpBridgeStatus('off');
      return;
    }
    const targets = () => filesRef.current.map((file) => ({
      id: file.id,
      name: file.name,
      mode: modeForName(file.name),
      content: file.content,
    }));
    const resolve = (args: Record<string, unknown>) => (
      resolveExternalTarget(targets(), activeIdRef.current, args)
    );
    const validationIssues = () => validateProject(
      filesRef.current,
      assetsRef.current.map((asset) => asset.path),
    );
    const stage = (
      kind: 'edit' | 'insert',
      args: Record<string, unknown>,
    ): BridgeMutationOutcome => {
      const target = resolve(args);
      if (!target) {
        const requested = typeof args.filename === 'string' && args.filename.trim()
          ? args.filename.trim()
          : 'the requested file';
        return { ok: false, message: `Dexter Write could not find ${requested}.` };
      }
      try {
        const result = kind === 'edit'
          ? stageExternalStringEdit(createWorkspace(), target, args)
          : stageExternalInsertion(createWorkspace(), target, args);
        if (!result.ok) return { ok: false, message: result.message };
        const apply = applyAiWorkspaceRef.current;
        if (!apply) return { ok: false, message: 'Dexter Write is not ready to apply changes yet.' };
        const applied = apply(result.workspace);
        if (!applied.ok) {
          return {
            ok: false,
            message: `Dexter Write could not apply that change because ${describeConflicts(applied.conflicts)}.`,
          };
        }
        setExternalApplied({ action: applied.action, summary: applied.action.summary, count: result.files });
        toast(`MCP applied ${result.name}. Undo is available.`, 'success', 5000);
        return {
          ok: true,
          message: `Applied ${result.name} immediately. Undo is available in Dexter Write.`,
          files: result.files,
          file: result.name,
        };
      } catch (error) {
        return {
          ok: false,
          message: `Dexter Write could not apply that change: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    };
    const access: BridgeAccess = {
      active: () => {
        const current = filesRef.current.find((f) => f.id === activeIdRef.current) ?? filesRef.current[0];
        return current
          ? { name: current.name, mode: modeForName(current.name), content: current.content }
          : { name: 'untitled.md', mode: 'markdown', content: '' };
      },
      files: () => filesRef.current.map((f) => ({
        name: f.name,
        mode: modeForName(f.name),
        lines: f.content ? f.content.split('\n').length : 0,
        active: f.id === activeIdRef.current,
      })),
      readFile: (args) => {
        const target = resolve(args);
        return target ? { name: target.name, mode: target.mode, content: target.content } : null;
      },
      stageEdit: (args) => stage('edit', args),
      insertContent: (args) => stage('insert', args),
      compile: async (args): Promise<BridgeCompileOutcome> => {
        const target = resolve(args);
        if (!target) {
          const outcome: BridgeCompileOutcome = {
            ok: false,
            file: '',
            mode: 'markdown',
            message: 'Dexter Write could not find that project file.',
            diagnostics: [],
          };
          lastCompileRef.current = outcome;
          return outcome;
        }
        const issues = validationIssues().filter((issue) => issue.file === target.name);
        const issueDiagnostics = issues.map((issue) => `[${issue.severity}] ${issue.message}`);
        let outcome: BridgeCompileOutcome;
        if (target.mode === 'markdown') {
          const errors = issues.filter((issue) => issue.severity === 'error').length;
          const ok = errors === 0;
          outcome = {
            ok,
            file: target.name,
            mode: target.mode,
            message: [
              ok
                ? `${target.name} checked successfully in markdown mode.`
                : `${target.name} has ${errors} validation error${errors === 1 ? '' : 's'}.`,
              ...issueDiagnostics,
            ].join('\n'),
            diagnostics: issueDiagnostics,
          };
        } else if (target.mode === 'latex') {
          const result = await compileLatexProject(runtimeRef.current, target.content, target.name);
          const diagnostics = [...issueDiagnostics, ...(result.warnings ?? [])];
          const ok = Boolean(result.success && result.pdf);
          const pages = typeof result.pages === 'number' ? result.pages : undefined;
          outcome = {
            ok,
            file: target.name,
            mode: target.mode,
            message: [
              ok
                ? `${target.name} compiled to PDF${pages ? ` (${pages} page${pages === 1 ? '' : 's'})` : ''}.`
                : `${target.name} failed to compile: ${result.error || 'unknown LaTeX error'}`,
              ...diagnostics,
            ].join('\n'),
            diagnostics,
            pages,
            compileMs: result.compileMs,
          };
        } else {
          const format = args.format === 'preview' ? 'svg' : 'pdf';
          const result = await compileTypstProject(runtimeRef.current, target.content, target.name, format);
          const typstDiagnostics = 'diagnostics' in result && Array.isArray(result.diagnostics)
            ? result.diagnostics
            : [];
          const diagnostics = [...issueDiagnostics, ...typstDiagnostics];
          const artifact = format === 'svg'
            ? ('svg' in result && Boolean(result.svg))
            : ('pdf' in result && Boolean(result.pdf));
          const ok = !result.error && artifact;
          outcome = {
            ok,
            file: target.name,
            mode: target.mode,
            message: [
              ok
                ? `${target.name} compiled to ${format === 'svg' ? 'SVG preview' : 'PDF'}.`
                : `${target.name} failed to compile: ${result.error || 'unknown Typst error'}`,
              ...diagnostics,
            ].join('\n'),
            diagnostics,
            compileMs: result.compileMs,
          };
        }
        lastCompileRef.current = outcome;
        toast(outcome.message.split('\n')[0], outcome.ok ? 'success' : 'error', 5000);
        return outcome;
      },
      diagnostics: (args): BridgeDiagnosticsOutcome => {
        const scoped = typeof args.filename === 'string' || typeof args.file_id === 'string';
        const target = scoped ? resolve(args) : null;
        if (scoped && !target) throw new Error('Dexter Write could not find that project file.');
        const filename = target?.name ?? '';
        const issues = validationIssues().filter((issue) => !filename || issue.file === filename);
        const compile = lastCompileRef.current;
        return {
          issues,
          compile: compile && (!filename || compile.file === filename) ? compile : null,
        };
      },
    };
    const client = new McpBridgeClient({ onStatus: setMcpBridgeStatus });
    client.start(access);
    return () => client.stop();
  }, [mcpBridgeEnabled]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(LS_THEME, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('dexter-write:citations', JSON.stringify(citations));
  }, [citations]);

  const lastSnapRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const timer = setInterval(() => {
      const cur = filesRef.current.find((f) => f.id === activeIdRef.current);
      if (cur && cur.content.trim()) {
        if (lastSnapRef.current[cur.id] === cur.content) return;
        saveSnapshot(cur.id, cur.name, cur.content, 'Auto periodic checkpoint')
          .then(() => { lastSnapRef.current[cur.id] = cur.content; })
          .catch(() => {});
      }
    }, 4 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const [lastSaved, setLastSaved] = useState<number | null>(null);
  useEffect(() => {
    setSaveState('saving');
    const save = () => {
      const result = saveProject(filesRef.current, activeIdRef.current);
      if (result.ok) { setSaveState('saved'); setLastSaved(Date.now()); setSaveError(''); }
      else { setSaveState('error'); setSaveError(result.error); toast(`Project save failed: ${result.error}. Download a backup ZIP.`, 'error', 7000); }
    };
    const timer = window.setTimeout(save, 400);
    window.addEventListener('pagehide', save);
    return () => { window.clearTimeout(timer); window.removeEventListener('pagehide', save); };
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
    else if (showCloud) setShowCloud(false);
    else if (showMcp) setShowMcp(false);
    else if (showByok) setShowByok(false);
    else if (aiFixProposal) setAiFixProposal(null);
    else if (paletteOpen) setPaletteOpen(false);
  }, [pendingImport, showCitations, showHistory, showShortcuts, showGithub, showLive, showCloud, showMcp, showByok, aiFixProposal, paletteOpen]);

  // Global shortcuts: palette, save-guard, Esc-to-close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const result = saveProject(filesRef.current, activeIdRef.current); toast(result.ok ? 'Project saved locally' : `Save failed: ${result.error}`, result.ok ? 'success' : 'error', 3500);
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

  // Cross-file port for the AI agent's project tools (list_files, read_file,
  // create_file, edit_file). A stable object that reads through refs, so the
  // agent engine never imports React state and never sees a stale snapshot.
  const fileAccess = useMemo<FileAccess>(() => ({
    list: () => filesRef.current.map((f) => ({
      name: f.name,
      mode: modeForName(f.name) || f.mode || 'markdown',
      lines: f.content ? f.content.split('\n').length : 0,
      active: f.id === activeIdRef.current,
    })),
    read: (name) => filesRef.current.find((f) => f.name === name)?.content ?? null,
    write: (name, content) => {
      const target = filesRef.current.find((f) => f.name === name);
      if (!target) return false;
      saveSnapshot(target.id, target.name, target.content, 'Pre-AI cross-file edit').catch(() => {});
      // The active file must go through setDocContent so collab stays in sync.
      if (target.id === activeIdRef.current) {
        setDocContent(content);
        return true;
      }
      setFiles((prev) => prev.map((f) => (f.id === target.id ? { ...f, content, updatedAt: Date.now() } : f)));
      liveRef.current?.setContent(target.id, content);
      return true;
    },
    create: (name, mode, content) => {
      const withExt = name.includes('.') ? name : `${name}.${extForMode(mode as DocMode)}`;
      const safeName = uniqueName(filesRef.current, withExt);
      const f = newProjectFile(safeName, (modeForName(safeName) || mode) as DocMode, content);
      setFiles((prev) => [...prev, f]);
      setActiveId(f.id);
      liveRef.current?.addFile(f);
      if (f.mode === 'typst') warmupTypstEngine();
      // Return the de-duplicated name so the agent refers to the real file.
      return safeName;
    },
    activeName: () => filesRef.current.find((f) => f.id === activeIdRef.current)?.name ?? '',
    idOf: (name) => filesRef.current.find((f) => f.name === name)?.id ?? null,
  }), [setDocContent]);

  const applyAiWorkspace = useCallback((workspace: StagedWorkspace): WorkspaceApplyResult => {
    const current = filesRef.current;
    const conflicts = findWorkspaceConflicts(workspace, current);
    if (conflicts.length > 0) return { ok: false, conflicts };

    const sess = liveRef.current;
    const now = Date.now();
    const created: ProjectFile[] = [];
    const updates = new Map<string, string>();
    const applied: AppliedWorkspaceFile[] = [];

    for (const change of workspace.changes) {
      if (change.before === null) {
        const file = newProjectFile(change.name, change.mode, change.after);
        created.push(file);
        applied.push({
          created: true,
          fileId: file.id,
          name: file.name,
          mode: file.mode,
          before: null,
          after: change.after,
        });
        continue;
      }
      const target = current.find((file) => (
        change.fileId ? file.id === change.fileId : file.name === change.name
      ));
      if (!target) {
        return {
          ok: false,
          conflicts: [{ key: change.key, name: change.name, reason: 'missing' }],
        };
      }
      saveSnapshot(target.id, target.name, target.content, `Pre-AI: ${workspaceSummary(workspace)}`).catch(() => {});
      updates.set(target.id, change.after);
      applied.push({
        created: false,
        fileId: target.id,
        name: target.name,
        mode: target.mode,
        before: change.before,
        after: change.after,
      });
    }

    if (created.length > 0) {
      setFiles((prev) => [...prev, ...created]);
      for (const file of created) {
        sess?.addFile(file);
        if (file.mode === 'typst') warmupTypstEngine();
      }
    }

    const activeId = activeIdRef.current;
    for (const [id, content] of updates) {
      if (id === activeId) {
        setDocContent(content);
      } else {
        setFiles((prev) => prev.map((file) => (
          file.id === id ? { ...file, content, updatedAt: now } : file
        )));
        sess?.setContent(id, content);
      }
    }

    filesRef.current = [...current, ...created].map((file) => {
      const content = updates.get(file.id);
      return content === undefined ? file : { ...file, content, updatedAt: now };
    });

    const action: AppliedAiAction = {
      id: newAiActionId(),
      createdAt: now,
      summary: workspaceSummary(workspace),
      files: applied,
      previousActiveId: activeIdRef.current,
    };
    const nextActive = workspace.activeName && [...current, ...created].find((file) => file.name === workspace.activeName);
    if (nextActive) {
      activeIdRef.current = nextActive.id;
      setActiveId(nextActive.id);
    }
    undoVersionRef.current++;
    setUndoAction(action);
    void persistAiAction(projectId, action).catch((e) => toast(`AI changes applied, but Undo could not be saved for reload: ${String(e)}. Undo is still available in this session.`, 'error', 7000));
    return { ok: true, action };
  }, [setDocContent, projectId]);
  applyAiWorkspaceRef.current = applyAiWorkspace;

  useEffect(() => {
    if (!cloudConfigured || !cloudProjectId || cloudLinkEpoch === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const metas = await listCloudFileMeta(cloudProjectId);
        if (cancelled) return;
        const baseline = makeBaseline(metas, filesRef.current);
        cloudBaselineRef.current = baseline;
        saveCloudBaseline(cloudProjectId, baseline);
      } catch {
        /* signed out or offline: the next explicit load can relink */
      }
    })();
    return () => { cancelled = true; };
  }, [cloudProjectId, cloudLinkEpoch]);

  useEffect(() => {
    if (!cloudConfigured || !cloudProjectId) return;
    let cancelled = false;
    let running = false;

    const tick = async () => {
      const session = liveRef.current;
      if (cancelled || running || document.hidden || session) return;
      if (Object.keys(cloudBaselineRef.current).length === 0) return;
      running = true;
      try {
        const metas = await listCloudFileMeta(cloudProjectId);
        if (cancelled) return;
        const baseline = cloudBaselineRef.current;
        const rows = changedFiles(metas, baseline);
        if (rows.length === 0) return;
        const changedRows = await fetchCloudFiles(cloudProjectId, rows.map((row) => row.path));
        if (cancelled) return;

        const updates = new Map<string, string>();
        const created: ProjectFile[] = [];
        const conflicts: string[] = [];
        const nextBaseline = { ...baseline };
        const now = Date.now();

        for (const row of changedRows) {
          const local = filesRef.current.find((file) => file.name === row.path);
          const known = baseline[row.path];
          if (local && known && !matchesBaseline(local.content, known)) {
            conflicts.push(row.path);
            nextBaseline[row.path] = { version: row.version, hash: contentHash(row.content) };
            continue;
          }
          if (!local) {
            created.push({
              id: row.id,
              name: row.path,
              mode: modeForName(row.path),
              content: row.content,
              updatedAt: Date.parse(row.updated_at) || now,
            });
            nextBaseline[row.path] = { version: row.version, hash: contentHash(row.content) };
            continue;
          }
          if (local.content === row.content) {
            nextBaseline[row.path] = { version: row.version, hash: contentHash(row.content) };
            continue;
          }
          saveSnapshot(local.id, local.name, local.content, 'Before cloud MCP edit').catch(() => {});
          updates.set(local.id, row.content);
          nextBaseline[row.path] = { version: row.version, hash: contentHash(row.content) };
        }

        const changedNames = changedRows.map((row) => row.path);
        if (created.length > 0) {
          setFiles((prev) => [...prev, ...created]);
          filesRef.current = [...filesRef.current, ...created];
          for (const file of created) {
            liveRef.current?.addFile(file);
            if (file.mode === 'typst') warmupTypstEngine();
          }
        }
        if (updates.size > 0) {
          const activeId = activeIdRef.current;
          setFiles((prev) => prev.map((file) => {
            const content = updates.get(file.id);
            return content === undefined ? file : { ...file, content, updatedAt: now };
          }));
          filesRef.current = filesRef.current.map((file) => {
            const content = updates.get(file.id);
            return content === undefined ? file : { ...file, content, updatedAt: now };
          });
          for (const [id, content] of updates) {
            liveRef.current?.setContent(id, content);
            if (id === activeId) setDocContent(content);
          }
        }
        if (created.length > 0 || updates.size > 0) {
          toast(
            `MCP applied cloud edits to ${changedNames.slice(0, 3).join(', ')}${changedNames.length > 3 ? ` +${changedNames.length - 3} more` : ''}. Undo is in Cloud → Recent MCP edits.`,
            'success',
            6500,
          );
        }
        if (conflicts.length > 0) {
          toast(
            `Cloud MCP changed ${conflicts.slice(0, 3).join(', ')}${conflicts.length > 3 ? ` +${conflicts.length - 3} more` : ''}. Local edits were kept; load from Cloud or push local to resolve.`,
            'info',
            7500,
          );
        }
        if (created.length > 0 || updates.size > 0 || conflicts.length > 0) {
          cloudBaselineRef.current = nextBaseline;
          saveCloudBaseline(cloudProjectId, nextBaseline);
        }
      } catch {
        /* offline, signed out, or cloud disabled: local editing continues */
      } finally {
        running = false;
      }
    };

    const timer = window.setInterval(() => { void tick(); }, 7000);
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [cloudProjectId, setDocContent]);

  const undoAppliedAction = useCallback((action: AppliedAiAction) => {
    const current = filesRef.current;
    const conflicts = findUndoConflicts(action, current);
    if (conflicts.length > 0) {
      toast(`Undo blocked because ${describeConflicts(conflicts)}. Nothing was overwritten.`, 'error', 7000);
      return;
    }

    const sess = liveRef.current;
    const now = Date.now();
    const removals = new Set<string>();
    const updates = new Map<string, string>();
    for (const file of action.files) {
      if (file.created) {
        removals.add(file.fileId);
        continue;
      }
      if (file.before === null) continue;
      updates.set(file.fileId, file.before);
      const target = current.find((item) => item.id === file.fileId);
      if (target) saveSnapshot(target.id, target.name, target.content, 'Pre-AI undo').catch(() => {});
    }

    const activeId = activeIdRef.current;
    setFiles((prev) => {
      let next = prev.filter((file) => !removals.has(file.id));
      if (updates.size > 0) {
        next = next.map((file) => {
          const content = updates.get(file.id);
          return content === undefined ? file : { ...file, content, updatedAt: now };
        });
      }
      return next;
    });
    filesRef.current = filesRef.current
      .filter((file) => !removals.has(file.id))
      .map((file) => {
        const content = updates.get(file.id);
        return content === undefined ? file : { ...file, content, updatedAt: now };
      });
    for (const [id, content] of updates) {
      sess?.setContent(id, content);
      if (id === activeId) setDocContent(content);
    }
    for (const id of removals) sess?.removeFile(id);
    if (action.previousActiveId && current.some((file) => file.id === action.previousActiveId && !removals.has(file.id))) {
      setActiveId(action.previousActiveId);
    } else if (removals.has(activeId)) {
      const remaining = current.filter((file) => !removals.has(file.id));
      if (remaining.length > 0) setActiveId(remaining[0].id);
    }

    undoVersionRef.current++;
    setUndoAction(null);
    setExternalApplied(null);
    clearUndoAction();
    void removeAiAction(projectId).catch((e) => toast(`Undo history cleanup failed: ${String(e)}`, 'error'));
    toast(`Undid ${action.summary}.`, 'success', 3500);
  }, [setDocContent, projectId]);

  const undoLastAiAction = useCallback(() => {
    if (undoAction) undoAppliedAction(undoAction);
  }, [undoAction, undoAppliedAction]);

  const setAiCompleteEnabled = useCallback((next: boolean, note?: string) => {
    setAiComplete(next);
    localStorage.setItem('dexter-write:ai-complete', next ? '1' : '0');
    if (note) toast(note, next ? 'success' : 'info', 3200);
  }, []);

  // In-editor AI settings: ghost-text completion and Ctrl+I inline edit.
  const editorAi = useMemo(() => ({
    provider,
    apiKey,
    model,
    baseUrl,
    completionEnabled: aiComplete,
    fileName: active?.name,
    onRateLimited: (message: string) => {
      setAiCompleteEnabled(false);
      toast(`AI completion paused — ${message.slice(0, 90)}`, 'info', 5000);
    },
    onBeforeApply: (content: string) => {
      const cur = filesRef.current.find((f) => f.id === activeIdRef.current);
      if (cur) saveSnapshot(cur.id, cur.name, content, 'Pre-AI inline edit').catch(() => {});
    },
    notify: (message: string, kind: 'success' | 'info' | 'error') => toast(message, kind, 2600),
  }), [provider, apiKey, model, baseUrl, aiComplete, active?.name, setAiCompleteEnabled]);

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

  function closeHub() { setShowHub(false); try { localStorage.setItem('dexter-write:started', '1'); } catch { /* save state reports project failures */ } }
  function createDocument(name: string, mode: DocMode, content: string) {
    const final = uniqueName(filesRef.current, projectPath(name));
    if (assets.some((a) => a.path === final)) throw new Error('This path belongs to an image; choose a document filename.');
    if (modeForName(final) !== mode) throw new Error('Choose a filename extension that matches the document format.');
    const file = newProjectFile(final, mode, content);
    setFiles((prev) => [...prev, file]); setActiveId(file.id); liveRef.current?.addFile(file);
  }
  async function uploadImages(incoming: File[], insert = false) {
    const targetId = activeIdRef.current;
    const next = [...assets];
    if (liveRef.current) toast('Images are saved on this device. Share a project ZIP with collaborators so they have the image files too.', 'info', 7000);
    for (const file of incoming) {
      const asset = await prepareAsset(file, projectId, next);
      await storeAsset(asset); next.push(asset); setAssets([...next]);
      if (insert) insertImage(asset, { alt: asset.name, caption: '', width: 60, align: 'center' }, targetId);
    }
  }
  function insertImage(asset: ProjectAsset, options: ImageOptions, targetId = activeIdRef.current) {
    const target = filesRef.current.find((f) => f.id === targetId); if (!target) return;
    try {
      const snippet = imageSnippet(target.mode, target.name, asset.path, options);
      saveSnapshot(target.id, target.name, target.content, 'Before image insertion').catch(() => {});
      let content = target.content;
      const holder = editorRef.current as { _editor?: { getModel: () => { getOffsetAt: (p: unknown) => number } | null; getPosition: () => unknown } } | null;
      const position = targetId === activeIdRef.current ? holder?._editor?.getPosition() : null;
      const offset = position ? holder?._editor?.getModel()?.getOffsetAt(position) : undefined;
      const end = target.mode === 'latex' ? content.lastIndexOf('\\end{document}') : -1;
      const bodyStart = target.mode === 'latex' ? content.indexOf('\\begin{document}') : -1;
      const at = target.mode === 'latex' && (offset === undefined || bodyStart >= 0 && offset < bodyStart + 16) ? end >= 0 ? end : content.length : offset !== undefined ? Math.min(offset, end >= 0 ? end : content.length) : content.length;
      content = content.slice(0, at) + snippet + content.slice(at);
      if (target.mode === 'latex' && !target.content.trim()) content = '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n' + snippet + '\n\\end{document}\n';
      if (target.mode === 'latex' && !/\\usepackage(?:\[[^\]]*\])?\{[^}]*graphicx[^}]*\}/.test(content)) content = content.replace(/\\begin\{document\}/, '\\usepackage{graphicx}\n\\begin{document}');
      const updated = content;
      setFiles((prev) => prev.map((f) => f.id === targetId ? { ...f, content: updated, updatedAt: Date.now() } : f)); liveRef.current?.setContent(targetId, content);
      setShowAssets(false); toast('Image inserted. No AI request was made.', 'success');
    } catch (e) { toast(String(e), 'error', 6000); }
  }
  async function renameImage(asset: ProjectAsset, requested: string) {
    const path = projectPath(requested);
    if (assets.some((a) => a.id !== asset.id && a.path === path)) throw new Error('That image path already exists.');
    if (asset.mime === 'image/png' ? !/\.png$/i.test(path) : !/\.jpe?g$/i.test(path)) throw new Error('Keep the original PNG or JPEG image format when renaming.');
    const updated = { ...asset, path, name: path.split('/').at(-1)!, updatedAt: Date.now() };
    await storeAsset(updated);
    setAssets((prev) => prev.map((a) => a.id === asset.id ? updated : a));
    for (const file of filesRef.current) {
      let content = file.content;
      for (const ref of documentReferences(content)) {
        try { if (resolveProjectPath(file.name, decodeURI(ref)) === asset.path) content = content.split(ref).join(relativeProjectPath(file.name, path)); } catch { /* external reference */ }
      }
      if (content !== file.content) { const text = content; saveSnapshot(file.id, file.name, file.content, 'Before image rename').catch(() => {}); setFiles((prev) => prev.map((f) => f.id === file.id ? { ...f, content: text, updatedAt: Date.now() } : f)); liveRef.current?.setContent(file.id, content); }
    }
  }
  async function importReviewed(incoming: ImportedProject, replace: boolean) {
    const current = replace ? [] : [...filesRef.current];
    const imported: ProjectFile[] = [], assetNext = [...assets], paths = new Map<string, string>();
    for (const document of incoming.documents) {
      const name = uniqueName([...current, ...imported], projectPath(document.path)); paths.set(document.path, name);
      imported.push(newProjectFile(name, modeForName(name), document.content));
    }
    const prepared: ProjectAsset[] = [];
    for (const image of incoming.images) { const asset = await prepareAsset(image, projectId, [...assetNext, ...prepared], image.name); paths.set(image.name, asset.path); prepared.push(asset); }
    for (let i = 0; i < imported.length; i++) {
      const original = incoming.documents[i].path, document = imported[i];
      for (const ref of documentReferences(document.content)) { try { const resolved = resolveProjectPath(original, decodeURI(ref)); const mapped = paths.get(resolved); if (mapped) document.content = document.content.split(ref).join(relativeProjectPath(document.name, mapped)); } catch { /* external ref */ } }
    }
    for (const asset of prepared) { await storeAsset(asset); assetNext.push(asset); setAssets([...assetNext]); }
    if (replace) {
      for (const file of filesRef.current) { await saveSnapshot(file.id, file.name, file.content, 'Before project restore'); liveRef.current?.removeFile(file.id); }
      setExternalApplied(null);
      if (cloudProjectId) clearCloudBaseline(cloudProjectId);
      cloudBaselineRef.current = {};
      setCloudProjectId('');
      try { localStorage.removeItem(LS_CLOUD_PROJECT); } catch { /* storage disabled */ }
      clearUndoAction(); await removeAiAction(projectId); undoVersionRef.current++; setUndoAction(null);
    }
    const final = [...current, ...imported];
    if (!final.length) final.push(newProjectFile('main.md', 'markdown', ''));
    setFiles(final); filesRef.current = final; for (const file of imported) liveRef.current?.addFile(file);
    const main = incoming.activeName && paths.get(incoming.activeName);
    setActiveId(final.find((f) => f.name === main)?.id || imported[0]?.id || final[0].id);
    toast(`Imported ${imported.length} documents and ${prepared.length} images.`, 'success');
  }
  async function applyCloudProject(cloudFiles: ProjectFile[], cloudAssets: ProjectAsset[], cloudActiveName: string) {
    const sess = liveRef.current;
    if (sess) {
      for (const file of filesRef.current) sess.removeFile(file.id);
      for (const file of cloudFiles) sess.addFile(file);
    }
    for (const asset of assetsRef.current) await removeAsset(asset.id);
    for (const asset of cloudAssets) await storeAsset(asset);
    setAssets(cloudAssets);
    setSharedAssetIds([]);
    setFiles(cloudFiles);
    filesRef.current = cloudFiles;
    const nextActiveId = cloudFiles.find((file) => file.name === cloudActiveName)?.id ?? cloudFiles[0]?.id ?? '';
    setActiveId(nextActiveId);
    activeIdRef.current = nextActiveId;
    setExternalApplied(null);
    undoVersionRef.current++;
    setUndoAction(null);
    clearUndoAction();
    void removeAiAction(projectId).catch(() => {});
  }
  async function validateCurrentProject(): Promise<string[]> {
    const issues = validateProject(filesRef.current, assets.map((a) => a.path));
    const report = issues.map((i) => `${i.file}: ${i.message}`);
    if (issues.some((i) => i.severity === 'error')) { setValidationStatus('Needs attention'); return report; }
    const current = filesRef.current.find((f) => f.id === activeIdRef.current);
    if (current && (current.mode === 'typst' || current.mode === 'latex')) {
      const result = current.mode === 'latex' ? await compileLatexProject(runtime, current.content, current.name) : await compileTypstProject(runtime, current.content, current.name);
      if (activeIdRef.current !== current.id || filesRef.current.find((f) => f.id === current.id)?.content !== current.content) { setValidationStatus('Draft'); return ['The document changed during validation. Validate the latest version again.', ...report]; }
      if (result.pdf) { report.unshift(`${current.name}: PDF compiled successfully.`); setValidationStatus(issues.length ? 'Needs review' : 'PDF compiled'); }
      else { report.unshift(`${current.name}: ${result.error || 'Compilation failed.'}`); setValidationStatus('Needs attention'); }
    } else { report.unshift('Reference and syntax checks complete.'); setValidationStatus(issues.length ? 'Needs review' : 'Validated'); }
    return report;
  }
  async function runExport(kind: ExportKind) {
    const issues = validateProject(filesRef.current, assets.map((a) => a.path));
    if (kind !== 'zip' && issues.length) {
      const proceed = await askConfirm({
        title: 'Export draft?',
        message: `This project has ${issues.length} validation warning(s).\n\n${issues.slice(0, 3).map((i) => i.message).join('\n')}`,
        confirmLabel: 'Export anyway',
        cancelLabel: 'Keep editing',
      });
      if (!proceed) return;
    }
    const task = kind === 'zip' ? exportProjectZip(filesRef.current, runtime) : doExport(kind, docContent, docMode, active?.name, runtime);
    void Promise.resolve(task).catch((e) => toast(`Export failed: ${String(e)}`, 'error', 7000));
  }

  const applyTemplateToActive = useCallback(async (id: string) => {
    const t = getTemplate(id);
    const aid = activeIdRef.current;
    const prior = filesRef.current.find((f) => f.id === aid);
    if (prior?.content) {
      const proceed = await askConfirm({
        title: 'Replace document content?',
        message: 'The current document will be replaced with template sample content. Use Project / Import if you want to create a separate document instead.',
        confirmLabel: 'Replace content',
        danger: true,
      });
      if (!proceed) return;
    }
    if (prior) saveSnapshot(prior.id, prior.name, prior.content, 'Before template replacement').catch(() => {});
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
    let safe: string; try { safe = projectPath(withExt); } catch (e) { toast(String(e), 'error'); return; }
    const name = uniqueName(filesRef.current, safe);
    if (assets.some((a) => a.path === name) || /\.(png|jpe?g|webp|svg|pdf|zip)$/i.test(name)) { toast('Use import or the image library for binary files.', 'error'); return; }
    const mode = raw.includes('.') ? modeForName(name) : newMode;
    const f = newProjectFile(name, mode, '');
    setFiles((prev) => [...prev, f]);
    setActiveId(f.id);
    setNewName('');
    liveRef.current?.addFile(f);
    if (mode === 'typst') warmupTypstEngine();
  }

  async function renameDocument(id: string) {
    const original = filesRef.current.find((file) => file.id === id); if (!original) return;
    const requested = await askPrompt({
      title: 'Rename or move file',
      message: 'Folders are allowed in the project path.',
      inputLabel: 'Project path',
      defaultValue: original.name,
      confirmLabel: 'Rename',
    });
    if (requested === null || requested === original.name) return;
    try {
      const name = projectPath(requested);
      if (filesRef.current.some((f) => f.id !== id && f.name === name) || assets.some((a) => a.path === name)) throw new Error('That project path already exists.');
      const mode = modeForName(name);
      if (mode !== original.mode) {
        const proceed = await askConfirm({
          title: 'Change document format?',
          message: 'Changing the extension changes the document format without converting its source.',
          confirmLabel: 'Continue',
          cancelLabel: 'Keep current extension',
        });
        if (!proceed) return;
      }
      const next = filesRef.current.map((file) => {
        const targetName = file.id === id ? name : file.name;
        let content = file.content;
        for (const ref of documentReferences(content)) {
          try {
            const path = resolveProjectPath(file.name, decodeURI(ref));
            const resolved = [path, path + '.tex', path + '.bib'].find((p) => filesRef.current.some((f) => f.name === p) || assets.some((a) => a.path === p));
            if (resolved && (file.id === id || resolved === original.name)) content = content.split(ref).join(relativeProjectPath(targetName, resolved === original.name ? name : resolved));
          } catch { /* external reference */ }
        }
        if (file.id === id || content !== file.content) {
          saveSnapshot(file.id, file.name, file.content, 'Before rename / move').catch(() => {});
          liveRef.current?.setMeta(file.id, { name: targetName, mode: file.id === id ? mode : file.mode });
          liveRef.current?.setContent(file.id, content);
          return { ...file, name: targetName, mode: file.id === id ? mode : file.mode, content, updatedAt: Date.now() };
        }
        return file;
      });
      setFiles(next);
    } catch (e) { toast(String(e), 'error', 6000); }
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
    undoVersionRef.current++;
    setUndoAction(null);
    clearUndoAction();
    void removeAiAction(projectId).catch((e) => toast(`Undo history cleanup failed: ${String(e)}`, 'error'));
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
    // Exact line numbers (markdown source-map, SyncTeX PDF clicks) jump directly.
    if (info.line) {
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
      acts.push({ id: `tpl-${t.id}`, group: 'Templates', label: `Replace current with ${t.label}`, icon: 'template', run: () => applyTemplateToActive(t.id) });
    }
    acts.push(
      { id: 'mode-md', group: 'Document', label: 'Switch to Markdown', icon: 'fileText', run: () => switchMode('markdown') },
      { id: 'mode-tex', group: 'Document', label: 'Switch to LaTeX', icon: 'book', run: () => switchMode('latex') },
      { id: 'mode-typ', group: 'Document', label: 'Switch to Typst', icon: 'bolt', run: () => switchMode('typst') },
      { id: 'theme', group: 'View', label: `Theme: switch to ${theme === 'dark' ? 'light' : 'dark'}`, icon: theme === 'dark' ? 'sun' : 'moon', run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
      { id: 'recompile', group: 'Document', label: 'Recompile document (Ctrl+Enter)', icon: 'bolt', run: triggerRecompile },
      ...(undoAction
        ? [{ id: 'undo-ai', group: 'Document', label: `Undo last AI action: ${undoAction.summary}`, icon: 'undo' as const, run: undoLastAiAction }]
        : []),
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
      { id: 'open-review', group: 'Open', label: 'Autonomous Document Review Agent', icon: 'fileText', run: () => setShowReview(true) },
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
          runExport(e.kind);
          toast('Export started', 'success', 2000);
        },
      });
    }
    if (live) {
      acts.push({ id: 'invite', group: 'Live', label: 'Copy invite link', icon: 'link', run: copyInvite });
      acts.push({ id: 'leave', group: 'Live', label: `Leave room ${live.room}`, icon: 'logout', run: leaveLive });
    } else {
      acts.push({ id: 'golive', group: 'Live', label: 'Start live collaboration…', icon: 'plug', run: () => { setLiveError(null); setShowLive(true); } });
    }
    return acts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, docMode, docContent, theme, sidebarTab, toggleSidebar, triggerRecompile, live, maximized, hidden, selection, applyTemplateToActive, switchMode, undoAction, undoLastAiAction]);

  return (
    <ProjectContext.Provider value={runtime}><div className="app">
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
        <div className="seg view-switch" role="group" aria-label="Mobile view">
          <button className={mobileView === 'editor' ? 'active' : ''} onClick={() => showMobileView('editor')} title="Editor">Editor</button>
          <button className={mobileView === 'preview' ? 'active' : ''} onClick={() => showMobileView('preview')} title="Preview">Preview</button>
          <button className={mobileView === 'chat' ? 'active' : ''} onClick={() => showMobileView('chat')} title="Project panel">Panel</button>
        </div>
        {!isVisible('right') && (
          <button className="btn xs btn-recompile" onClick={triggerRecompile} title="Recompile document (Ctrl+Enter)">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            <span>Recompile</span>
          </button>
        )}
        <div className="spacer" />
        <div className="tb-group">
          <select
            className="tb-select"
            aria-label="Export"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value as ExportKind | '';
              e.target.value = '';
              if (!v) return;
              runExport(v);
            }}
          >
            <option value="" disabled>Export</option>
            <option value="pdf">PDF</option>
            <option value="typst-pdf" disabled={docMode !== 'typst'}>Typst PDF (vector)</option>
            <option value="tex" disabled={docMode !== 'latex'}>LaTeX .tex</option>
            <option value="md" disabled={docMode !== 'markdown'}>Markdown .md</option>
            <option value="typ" disabled={docMode !== 'typst'}>Typst .typ</option>
            <option value="html" disabled={docMode !== 'markdown'}>Styled HTML</option>
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
            <button className="btn xs ghost icon-btn tb-live" onClick={() => { setLivePrefill({ room: '', password: '' }); setLiveError(null); setShowLive(true); }} title="Real-time P2P collaboration" aria-label="Start live collaboration">
              <Icon name="plug" size={14} />
            </button>
          )}
          {undoAction && (
            <button
              className="btn xs tb-undo"
              onClick={undoLastAiAction}
              title={`Undo last AI action: ${undoAction.summary}`}
            >
              <Icon name="undo" size={14} /><span className="btn-label optional">Undo AI</span>
            </button>
          )}
          <button className="btn xs icon-btn tb-theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
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
          <button className="act-btn" onClick={() => setShowHub(true)} title="Create, import, templates and backup" aria-label="Project start"><Icon name="plus" size={17} /></button>
          <button className="act-btn" onClick={() => setShowAssets(true)} title="Images and attachments" aria-label="Images and attachments"><Icon name="image" size={17} /></button>
          <button
            className={`act-btn ${sidebarTab === 'files' ? 'active' : ''}`}
            onClick={() => openToolPanel('files')}
            title="Project Files"
            aria-label="Project Files"
          >
            <Icon name="files" size={17} />
          </button>
          <button
            className={`act-btn ${sidebarTab === 'ai' ? 'active' : ''}`}
            onClick={() => openToolPanel('ai')}
            title="AI Assistant"
            aria-label="AI Assistant"
          >
            <Icon name="sparkles" size={17} />
          </button>
          <button
            className={`act-btn ${sidebarTab === 'outline' ? 'active' : ''}`}
            onClick={() => openToolPanel('outline')}
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
            <Icon name="fileText" size={16} />
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
            onClick={() => setShowCloud(true)}
            title="Cloud sync & remote MCP"
            aria-label="Cloud sync and remote MCP"
          >
            <Icon name="cloud" size={16} />
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
        {(
          <section className="pane left" style={{ ...(maximized ? { flex: 1 } : { width: `${leftPct}%` }), display: sidebarTab !== null && isVisible('left') ? undefined : 'none' }}>
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
                <div className="filetree-content" style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
                  <ProjectFileTree files={files} activeId={activeId} onSelect={setActiveId} onRename={renameDocument} onDelete={(id) => { const file = filesRef.current.find((f) => f.id === id); if (!file) return; void askConfirm({ title: `Delete ${file.name}?`, message: 'This removes the file from the project. Download a backup first if you need it.', confirmLabel: 'Delete file', danger: true }).then((ok) => { if (ok) removeFile(id); }); }} />
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

            {(
              <div className="sidebar-drawer ai-drawer" style={{ display: sidebarTab === 'ai' ? undefined : 'none' }}>
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
                  fileId={active?.id}
                  provider={provider}
                  apiKey={apiKey}
                  model={model}
                  baseUrl={baseUrl}
                  selection={selection}
                  clearSelection={() => setSelection(null)}
                  editorRef={editorRef}
                  servers={servers}
                  theme={theme}
                  files={fileAccess}
                  sharedAssets={assets.filter((a) => sharedAssetIds.includes(a.id))}
                  onConsumeSharedAssets={() => setSharedAssetIds([])}
                  onApplyWorkspace={applyAiWorkspace}
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
                <span className="muted small hide-sm">{docMode === 'markdown' ? 'Markdown' : docMode === 'latex' ? 'LaTeX' : 'Typst'} · {docContent.split('\n').length} lines{live ? ` · ${live.room}` : ''}</span>
                <button className="btn xs ghost icon-btn" onClick={() => toggleMax('center')} title={maximized === 'center' ? 'Restore split view' : 'Maximize editor'}>
                  <Icon name={maximized === 'center' ? 'minimize' : 'expand'} size={13} />
                </button>
              </span>
            </div>
            <div className="filebar">
              <div className="tabs">
                {files.map((f) => (
                  <div key={f.id} className={`tab ${f.id === activeId ? 'active' : ''}`} title={f.name}>
                    <button type="button" className="tab-main" onClick={() => setActiveId(f.id)}>
                      <Icon name="fileText" size={12} className="ficon" />
                      <span className="tab-name">{f.name}</span>
                    </button>
                    {files.length > 1 && (
                      <button
                        type="button"
                        className="tab-close"
                        onClick={() => removeFile(f.id)}
                        title={`Close ${f.name}`}
                        aria-label={`Close ${f.name}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
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
                aria-label="New file"
              >
                <Icon name="plus" size={13} />
              </button>
            </div>
            <div className="editor-main" style={{ flex: 1, minHeight: 0 }}
              onPasteCapture={(e) => { const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/')); if (images.length) { e.preventDefault(); e.stopPropagation(); void uploadImages(images, true).catch((err) => toast(String(err), 'error')); } }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
              onDropCapture={(e) => { const images = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/')); if (images.length) { e.preventDefault(); e.stopPropagation(); void uploadImages(images, true).catch((err) => toast(String(err), 'error')); } }}
            >
              <EditorPane
                key={live ? `live-${live.room}-${active?.id}` : `local-${active?.id}`}
                value={docContent}
                mode={docMode}
                theme={theme}
                onChange={setDocContent}
                onSelection={(text, startLine, endLine) => setSelection(text ? { text, startLine, endLine } : null)}
                editorRef={editorRef}
                collab={live && active ? { session: live, fileId: active.id } : null}
                ai={editorAi}
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
            <PreviewPane
              content={docContent}
              fileName={active?.name}
              mode={docMode}
              theme={theme}
              onSourceJump={handleSourceJump}
              compileTrigger={recompileSeq}
              onToggleMax={() => toggleMax('right')}
              maximized={maximized === 'right'}
              onHide={() => hideSide('right')}
              onFixProposal={(p) => setAiFixProposal(p)}
              provider={provider}
              apiKey={apiKey}
              model={model}
              baseUrl={baseUrl}
              onOpenByok={() => setShowByok(true)}
            />
          </section>
        )}
      </main>

      <footer className="statusbar">
        <span className="stat" title={active?.name}>{active?.name}</span>
        <button className="stat stat-btn status-project" onClick={() => setShowHub(true)} title="Create, import, templates and backup">
          <Icon name="plus" size={11} /> Project
        </button>
        <span className="stat status-validation">{validationStatus}</span>
        <span className="stat status-words" title={`${stats.chars} characters · ${stats.lines} lines · ~${stats.readingTimeMin} min read`}>{stats.words} words</span>
        <span className={`stat status-save${saveState === 'error' ? ' danger-text' : ''}`} title="Autosaved to browser storage" aria-live="polite">
          <Icon name={saveState === 'error' ? 'x' : 'check'} size={11} /> {saveState === 'error' ? `Save failed: ${saveError}` : saveState === 'saving' ? 'Saving…' : 'Saved'}{saveState === 'saved' && lastSaved ? ` ${new Date(lastSaved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
        </span>
        <span className="spacer" />
        <button
          className={`stat stat-btn status-ai${aiComplete ? ' on' : ''}`}
          onClick={() => setAiCompleteEnabled(
            !aiComplete,
            aiComplete ? 'AI completion off' : 'AI completion on — pause while typing, then Tab to accept',
          )}
          title={aiComplete
            ? 'AI ghost-text completion is ON — click to turn off'
            : 'AI ghost-text completion is OFF — click to turn on (spends one API call per typing pause)'}
          aria-pressed={aiComplete}
        >
          <Icon name="wand" size={11} /> AI complete {aiComplete ? 'on' : 'off'}
        </button>
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
        <button
          className={`stat stat-btn status-bridge${mcpBridgeStatus === 'live' ? ' on' : ''}`}
          onClick={() => setMcpBridgeEnabled((value) => !value)}
          title={!mcpBridgeEnabled
            ? 'Local MCP bridge is off — click to let Claude Desktop or Cursor read this project'
            : mcpBridgeStatus === 'live'
              ? 'Local MCP bridge is connected — external agents can read the active document, outline, and file list'
              : mcpBridgeStatus === 'offline'
                ? 'No dexter-mcp daemon detected on 127.0.0.1:3088 — run npm run mcp'
                : 'Connecting to the local dexter-mcp daemon…'}
          aria-pressed={mcpBridgeEnabled}
          aria-label="Local MCP bridge"
        >
          <Icon name="plug" size={11} /> Bridge {mcpBridgeStatus === 'connecting' ? 'connecting' : mcpBridgeStatus}
        </button>
        <span className="stat hide-mobile">{files.length} files</span>
        {connectedCount > 0 && <span className="stat hide-mobile">MCP {connectedCount}</span>}
        <span className="stat hide-mobile">{resolveProvider(provider).label}:{model}</span>
        <span className="stat status-key">{apiKey ? 'Key saved' : !resolveProvider(provider).needsKey ? 'Local mode' : 'No key'}</span>
        <span className="stat status-online" title={online ? 'Online' : 'Offline — local mode'}>
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
      {aiFixProposal && (
        <DiffReviewModal
          summary={aiFixProposal.summary}
          before={aiFixProposal.before}
          after={aiFixProposal.after}
          language={docMode === 'latex' ? 'latex' : docMode === 'typst' ? 'typst' : 'markdown'}
          mode={docMode}
          theme={theme}
          onAccept={(finalContent) => {
            setDocContent(finalContent);
            setAiFixProposal(null);
            triggerRecompile();
            toast('Fix applied! Recompiling document…', 'success', 2500);
          }}
          onClose={() => setAiFixProposal(null)}
        />
      )}
      {showMcp && (
        <McpManager
          servers={servers}
          setServers={setServers}
          bridgeEnabled={mcpBridgeEnabled}
          bridgeStatus={mcpBridgeStatus}
          onToggleBridge={() => setMcpBridgeEnabled((enabled) => !enabled)}
          onClose={() => setShowMcp(false)}
        />
      )}
      {showCloud && (
        <CloudPanel
          files={files}
          assets={assets}
          activeName={active?.name ?? ''}
          localProjectId={projectId}
          onLoad={applyCloudProject}
          onLink={linkCloudProject}
          onClose={() => setShowCloud(false)}
        />
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
      {showAssets && <AssetLibraryModal onClose={() => setShowAssets(false)} onUpload={uploadImages} onInsert={insertImage} onRename={renameImage} onDelete={async (asset) => { await removeAsset(asset.id); setAssets((prev) => prev.filter((a) => a.id !== asset.id)); setSharedAssetIds((prev) => prev.filter((id) => id !== asset.id)); }} shared={sharedAssetIds} onShare={setSharedAssetIds} />}
      {showHub && <ProjectHubModal onClose={closeHub} onCreate={createDocument} onImport={importReviewed} onAI={() => { closeHub(); setSidebarTab('ai'); }} onAssets={() => { closeHub(); setShowAssets(true); }} onBackup={() => runExport('zip')} onValidate={validateCurrentProject} />}
      {externalApplied && (
        <ExternalAgentBanner
          count={externalApplied.count}
          summary={externalApplied.summary}
          onUndo={() => undoAppliedAction(externalApplied.action)}
          onDismiss={() => setExternalApplied(null)}
        />
      )}
      <Toasts />
      <DialogHost />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
    </div></ProjectContext.Provider>
  );
}
