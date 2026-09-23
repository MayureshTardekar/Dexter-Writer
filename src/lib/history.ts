import { getDocStats } from './docUtils';

export interface DocSnapshot {
  id: string;
  fileId: string;
  fileName: string;
  timestamp: number;
  label: string;
  content: string;
  words: number;
  chars: number;
}

const DB_NAME = 'dexter_write_history_db';
const STORE_NAME = 'snapshots';
const DB_VERSION = 1;
const MAX_SNAPSHOTS_PER_FILE = 50;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('fileId', 'fileId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(
  fileId: string,
  fileName: string,
  content: string,
  label = 'Auto checkpoint',
): Promise<DocSnapshot> {
  const stats = getDocStats(content);
  const snap: DocSnapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fileId,
    fileName,
    timestamp: Date.now(),
    label,
    content,
    words: stats.words,
    chars: stats.chars,
  };

  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add(snap);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Prune excess snapshots
    pruneSnapshots(fileId).catch(() => {});
  } catch {
    // Fallback to localStorage
    try {
      const key = `dexter_snaps_${fileId}`;
      const existing: DocSnapshot[] = JSON.parse(localStorage.getItem(key) || '[]');
      existing.unshift(snap);
      if (existing.length > MAX_SNAPSHOTS_PER_FILE) existing.pop();
      localStorage.setItem(key, JSON.stringify(existing));
    } catch {
      /* storage quota exceeded or disabled */
    }
  }

  return snap;
}

export async function getSnapshots(fileId?: string): Promise<DocSnapshot[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return await new Promise<DocSnapshot[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        let all: DocSnapshot[] = req.result || [];
        if (fileId) all = all.filter((s) => s.fileId === fileId);
        all.sort((a, b) => b.timestamp - a.timestamp);
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    if (!fileId) return [];
    try {
      const key = `dexter_snaps_${fileId}`;
      const list: DocSnapshot[] = JSON.parse(localStorage.getItem(key) || '[]');
      return list.sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      return [];
    }
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* noop fallback */
  }
}

async function pruneSnapshots(fileId: string): Promise<void> {
  const snaps = await getSnapshots(fileId);
  if (snaps.length <= MAX_SNAPSHOTS_PER_FILE) return;
  const toDelete = snaps.slice(MAX_SNAPSHOTS_PER_FILE);
  for (const s of toDelete) {
    await deleteSnapshot(s.id);
  }
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
