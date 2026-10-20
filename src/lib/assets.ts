import { projectPath, relativeProjectPath } from './projectPaths';
import type { DocMode } from './templates';

export interface ProjectAsset {
  id: string; projectId: string; path: string; name: string; mime: string;
  size: number; width: number; height: number; createdAt: number; updatedAt: number;
  blob: Blob;
}
export const IMAGE_TYPES = ['image/png', 'image/jpeg'];
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
let dbPromise: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  return dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('dexter-write-assets', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('assets', { keyPath: 'id' }).createIndex('projectId', 'projectId');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = undefined; reject(req.error); };
  });
}
async function transaction<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', mode);
    const req = op(tx.objectStore('assets'));
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = tx.onerror = () => reject(tx.error || req.error || new Error('Asset storage failed.'));
  });
}
export function listAssets(projectId: string): Promise<ProjectAsset[]> {
  return transaction('readonly', (store) => store.index('projectId').getAll(projectId));
}
export async function storeAsset(asset: ProjectAsset): Promise<void> {
  projectPath(asset.path);
  await transaction('readwrite', (store) => store.put(asset));
}
export async function removeAsset(id: string): Promise<void> { await transaction('readwrite', (store) => store.delete(id)); }
export function uniqueAssetPath(existing: Array<{ path: string }>, name: string, preservePath = false): string {
  const path = projectPath(preservePath || name.startsWith('assets/') ? name : `assets/${name}`);
  const dot = path.lastIndexOf('.');
  let next = path, index = 2;
  while (existing.some((a) => a.path === next)) next = `${path.slice(0, dot)}-${index++}${path.slice(dot)}`;
  return next;
}
export async function prepareAsset(file: File, projectId: string, existing: Array<{ path: string }>, requestedPath?: string): Promise<ProjectAsset> {
  if (file.size > MAX_ASSET_BYTES) throw new Error(`${file.name}: maximum image size is 10 MB.`);
  if (![...IMAGE_TYPES, 'image/webp'].includes(file.type)) throw new Error(`${file.name}: use PNG, JPEG or WebP images.`);
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('Image exceeds 40 megapixels. Resize it before uploading.');
    let blob: Blob = file;
    let name = requestedPath || file.name;
    if (file.type === 'image/webp') {
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Image conversion failed.')), 'image/png'));
      name = name.replace(/\.webp$/i, '') + '.png';
    }
    const path = uniqueAssetPath(existing, name, requestedPath !== undefined);
    return { id: crypto.randomUUID(), projectId, path, name: path.split('/').at(-1)!, mime: blob.type, size: blob.size, width: bitmap.width, height: bitmap.height, blob, createdAt: Date.now(), updatedAt: Date.now() };
  } finally { bitmap.close(); }
}
export interface ImageOptions { alt: string; caption: string; width: number; align: 'left' | 'center' | 'right' }
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escapeTex = (s: string) => s.replace(/[\\{}$%&#_~^]/g, (c) => ({ '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }[c] || `\\${c}`));
export function imageSnippet(mode: DocMode, document: string, path: string, options: ImageOptions): string {
  const ref = relativeProjectPath(document, path);
  const width = Math.max(5, Math.min(100, options.width || 60));
  if (mode === 'latex') {
    if (/[{}%#\\]/.test(ref)) throw new Error('Rename the image to remove LaTeX special characters from its path.');
    return `\n\\begin{figure}[htbp]\n\\${options.align === 'center' ? 'centering' : options.align === 'left' ? 'raggedright' : 'raggedleft'}\n\\includegraphics[width=${width / 100}\\linewidth]{${ref}}\n${options.caption ? `\\caption{${escapeTex(options.caption)}}\n` : ''}\\end{figure}\n`;
  }
  if (mode === 'typst') return `\n#align(${options.align})[#figure(image(${JSON.stringify(ref)}, width: ${width}%, alt: ${JSON.stringify(options.alt)}), caption: ${options.caption ? JSON.stringify(options.caption) : 'none'})]\n`;
  return `\n<figure style="text-align:${options.align}">\n<img src="${escapeHtml(encodeURI(ref))}" alt="${escapeHtml(options.alt)}" width="${width}%" />\n${options.caption ? `<figcaption>${escapeHtml(options.caption)}</figcaption>\n` : ''}</figure>\n`;
}

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
}
