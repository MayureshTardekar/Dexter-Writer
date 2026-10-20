import type { AppliedAiAction } from './aiWorkspace';

let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  return connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('dexter-write-ai-actions', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('actions', { keyPath: 'projectId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = undefined; reject(request.error); };
  });
}
async function operation<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('actions', mode), request = action(tx.objectStore('actions'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Undo storage failed.'));
  });
}
export async function readAiAction(projectId: string): Promise<AppliedAiAction | null> {
  const record = await operation<{ projectId: string; action: AppliedAiAction } | undefined>('readonly', (store) => store.get(projectId));
  return record?.action ?? null;
}
export async function persistAiAction(projectId: string, action: AppliedAiAction): Promise<void> {
  await operation('readwrite', (store) => store.put({ projectId, action }));
}
export async function removeAiAction(projectId: string): Promise<void> { await operation('readwrite', (store) => store.delete(projectId)); }
