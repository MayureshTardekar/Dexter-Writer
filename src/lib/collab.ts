import type * as Y from 'yjs';
import type { WebrtcProvider } from 'y-webrtc';
import type { IndexeddbPersistence } from 'y-indexeddb';
import type { Awareness } from 'y-protocols/awareness';
import { createMonacoBinding, type BindingEditor, type BindingModel, type BindingMonacoNs, type YPositionLib } from './monacoBinding';
import type { ProjectFile } from './projectFiles';
import type { DocMode } from './templates';

// Phase 3: peer-to-peer Yjs collaboration (no central database).
// One Y.Doc per room: `files` (id -> Y.Text content) + `meta` (id -> {name, mode}).
// Character edits flow Monaco <-> Y.Text via y-monaco bindings; the React
// state stays in sync through Monaco onChange, so no content observers are
// needed (and no echo loops). File add/remove/rename go through Y maps.

export interface CollabPeer {
  clientId: number;
  name: string;
  color: string;
  self: boolean;
}

export interface FileMeta {
  name: string;
  mode: DocMode;
}

export interface CollabEvents {
  onFiles: (files: ProjectFile[]) => void;
  onPeers: (peers: CollabPeer[]) => void;
}

export interface LiveEditorHandle {
  destroy: () => void;
}

const LS_NAME = 'dexter-write:collab-name';

const PALETTE = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#818cf8', '#e879f9', '#f472b6'];

export function getSelfName(): string {
  let n = '';
  try { n = localStorage.getItem(LS_NAME) || ''; } catch { /* ignore */ }
  if (!n) {
    n = `Writer-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    try { localStorage.setItem(LS_NAME, n); } catch { /* ignore */ }
  }
  return n;
}

export function setSelfName(n: string): void {
  try { localStorage.setItem(LS_NAME, n); } catch { /* ignore */ }
}

export function colorFor(clientId: number): string {
  return PALETTE[Math.abs(clientId) % PALETTE.length];
}

export function newRoomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function parseRoomHash(): { room: string; password: string } | null {
  try {
    const h = window.location.hash.replace(/^#/, '');
    const q = new URLSearchParams(h);
    const room = q.get('room');
    if (!room) return null;
    return { room, password: q.get('key') || '' };
  } catch {
    return null;
  }
}

export function writeRoomHash(room: string, password: string): void {
  const q = new URLSearchParams();
  q.set('room', room);
  if (password) q.set('key', password);
  window.location.hash = q.toString();
}

export function clearRoomHash(): void {
  try {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch { window.location.hash = ''; }
}

function signalingUrls(): string[] | undefined {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SIGNALING_URL;
    if (raw) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  } catch { /* ignore */ }
  return undefined;
}

export interface CollabSession {
  room: string;
  hasPassword: boolean;
  selfName: string;
  awareness: Awareness;
  getYText: (id: string) => Y.Text | undefined;
  ensureYText: (id: string, seed: string) => Y.Text;
  setContent: (id: string, content: string) => void;
  addFile: (f: ProjectFile) => void;
  removeFile: (id: string) => void;
  setMeta: (id: string, meta: FileMeta) => void;
  bindEditor: (ytext: Y.Text, model: unknown, editor: unknown, monacoNs: unknown) => LiveEditorHandle;
  peers: () => CollabPeer[];
  destroy: () => void;
}

export async function startCollab(room: string, password: string, localFiles: ProjectFile[], selfName: string, events: CollabEvents): Promise<CollabSession> {
  const [yjs, wrtc, idb] = await Promise.all([import('yjs'), import('y-webrtc'), import('y-indexeddb')]);
  const ylib: YPositionLib = {
    createRelativePositionFromTypeIndex: yjs.createRelativePositionFromTypeIndex,
    createAbsolutePositionFromRelativePosition: yjs.createAbsolutePositionFromRelativePosition,
  };
  const doc: Y.Doc = new yjs.Doc();
  const files = doc.getMap<Y.Text>('files');
  const meta = doc.getMap<FileMeta>('meta');

  const provider: WebrtcProvider = new wrtc.WebrtcProvider(room, doc, {
    signaling: signalingUrls(),
    password: password || undefined,
  });
  const persistence: IndexeddbPersistence = new idb.IndexeddbPersistence(`dexter-write:${room}`, doc);
  const awareness = provider.awareness as Awareness;
  const color = colorFor(doc.clientID);
  awareness.setLocalStateField('user', { name: selfName, color });

  const readAll = (): ProjectFile[] => {
    const out: ProjectFile[] = [];
    // Preserve local order for known ids, append remote-only ids.
    const seen = new Set<string>();
    for (const lf of localFiles) {
      const yt = files.get(lf.id);
      const m = meta.get(lf.id);
      out.push({
        id: lf.id,
        name: m?.name ?? lf.name,
        mode: (m?.mode as DocMode) ?? lf.mode,
        content: yt ? yt.toString() : lf.content,
        updatedAt: lf.updatedAt,
      });
      seen.add(lf.id);
    }
    files.forEach((yt, id) => {
      if (seen.has(id)) return;
      const m = meta.get(id);
      out.push({ id, name: m?.name ?? `${id}.md`, mode: (m?.mode as DocMode) ?? 'markdown', content: yt.toString(), updatedAt: Date.now() });
    });
    return out;
  };

  // Seed local files into the shared doc (no-op for keys already present).
  doc.transact(() => {
    for (const lf of localFiles) {
      if (!files.has(lf.id)) {
        const yt = new yjs.Text();
        yt.insert(0, lf.content);
        files.set(lf.id, yt);
        meta.set(lf.id, { name: lf.name, mode: lf.mode });
      }
    }
  });

  // Push current (merged) state to React.
  const pushFiles = () => events.onFiles(readAll());
  const filesObserver = () => pushFiles();
  const metaObserver = () => pushFiles();
  files.observe(filesObserver);
  meta.observe(metaObserver);

  const pushPeers = () => {
    const peers: CollabPeer[] = [];
    awareness.getStates().forEach((st, clientId) => {
      const u = (st as unknown as { user?: { name?: string; color?: string } }).user;
      peers.push({
        clientId: clientId as number,
        name: u?.name || `peer-${String(clientId).slice(-4)}`,
        color: u?.color || colorFor(clientId as number),
        self: (clientId as number) === doc.clientID,
      });
    });
    peers.sort((a, b) => Number(b.self) - Number(a.self));
    events.onPeers(peers);
  };
  awareness.on('change', pushPeers);
  pushPeers();
  // Initial merge (IndexedDB may hydrate a moment later and re-fire).
  pushFiles();
  persistence.on('synced', pushFiles);

  let destroyed = false;
  return {
    room,
    hasPassword: !!password,
    selfName,
    awareness,
    getYText: (id) => files.get(id),
    ensureYText: (id, seed) => {
      let yt = files.get(id);
      if (!yt) {
        yt = new yjs.Text();
        yt.insert(0, seed);
        files.set(id, yt);
      }
      return yt;
    },
    setContent: (id, content) => {
      const yt = files.get(id);
      if (!yt || yt.toString() === content || destroyed) return;
      doc.transact(() => {
        yt.delete(0, yt.length);
        yt.insert(0, content);
      });
    },
    addFile: (f) => {
      doc.transact(() => {
        if (!files.has(f.id)) {
          const yt = new yjs.Text();
          yt.insert(0, f.content);
          files.set(f.id, yt);
          meta.set(f.id, { name: f.name, mode: f.mode });
        }
      });
    },
    removeFile: (id) => {
      doc.transact(() => {
        files.delete(id);
        meta.delete(id);
      });
    },
    setMeta: (id, m) => {
      meta.set(id, m);
    },
    bindEditor: (ytext, model, editor, monacoNs) => {
      return createMonacoBinding({
        ytext,
        model: model as BindingModel,
        editor: editor as BindingEditor,
        monaco: monacoNs as BindingMonacoNs,
        awareness,
        ylib,
      });
    },
    peers: () => {
      const peers: CollabPeer[] = [];
      awareness.getStates().forEach((st, clientId) => {
        const u = (st as unknown as { user?: { name?: string; color?: string } }).user;
        peers.push({
          clientId: clientId as number,
          name: u?.name || `peer-${String(clientId).slice(-4)}`,
          color: u?.color || colorFor(clientId as number),
          self: (clientId as number) === doc.clientID,
        });
      });
      return peers;
    },
    destroy: () => {
      destroyed = true;
      try { files.unobserve(filesObserver); } catch { /* noop */ }
      try { meta.unobserve(metaObserver); } catch { /* noop */ }
      try { awareness.off('change', pushPeers); } catch { /* noop */ }
      try { provider.destroy(); } catch { /* noop */ }
      try { persistence.destroy(); } catch { /* noop */ }
      try { doc.destroy(); } catch { /* noop */ }
    },
  };
}
