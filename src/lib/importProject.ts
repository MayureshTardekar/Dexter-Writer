import { projectPath } from './projectPaths';
import type { ZipEntry } from './zip';
import { crc32 } from './zip';

const MAX_TOTAL = 50 * 1024 * 1024;
export const TEXT_EXTENSIONS = /\.(?:md|markdown|tex|typ|txt|bib|sty|cls|json|csv)$/i;
export interface ImportedProject { documents: Array<{ path: string; content: string }>; images: File[]; activeName?: string; warnings: string[] }

/** Read central-directory entries; supports stored and deflated ZIPs. */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  if (bytes.length > MAX_TOTAL) throw new Error('ZIP exceeds 50 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) if (view.getUint32(end, true) === 0x06054b50) break;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error('Invalid ZIP directory.');
  const count = view.getUint16(end + 10, true);
  if (count > 200 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('Use a single ZIP with at most 200 files.');
  let offset = view.getUint32(end + 16, true), total = 0;
  const entries: ZipEntry[] = [], names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP entry.');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true), packed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength + extra + comment > end) throw new Error('Invalid ZIP entry bounds.');
    const rawName = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extra + comment;
    if (rawName.endsWith('/')) continue;
    const name = projectPath(rawName);
    if (names.has(name)) throw new Error(`Duplicate ZIP path: ${name}`);
    names.add(name); total += size;
    if (total > MAX_TOTAL || flags & 1 || ![0, 8].includes(method)) throw new Error('ZIP is encrypted, too large, or uses unsupported compression.');
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new Error('Invalid local ZIP entry.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > bytes.length) throw new Error('Truncated ZIP entry.');
    let data = bytes.slice(start, start + packed);
    if (method === 8) {
      const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader(), chunks: Uint8Array[] = [];
      let length = 0;
      while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > size || length > MAX_TOTAL) { await reader.cancel(); throw new Error('ZIP expansion exceeds declared size.'); } chunks.push(part.value); }
      data = new Uint8Array(length); let at = 0; for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
    }
    if (data.length !== size || crc32(data) !== crc) throw new Error(`ZIP checksum mismatch: ${name}`);
    entries.push({ name, data });
  }
  return entries;
}

export async function importFiles(files: File[]): Promise<ImportedProject> {
  const result: ImportedProject = { documents: [], images: [], warnings: [] };
  let total = 0;
  async function add(path: string, data: Uint8Array) {
    path = projectPath(path); total += data.length;
    if (total > MAX_TOTAL) throw new Error('Import exceeds 50 MB.');
    if (path === '.dexter/project.json') {
      const manifest = JSON.parse(new TextDecoder().decode(data));
      if (manifest.version === 1 && typeof manifest.activeName === 'string') result.activeName = projectPath(manifest.activeName);
    } else if (TEXT_EXTENSIONS.test(path)) result.documents.push({ path, content: new TextDecoder().decode(data) });
    else if (/\.(png|jpe?g|webp)$/i.test(path)) result.images.push(new File([new Uint8Array(data)], path, { type: /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg' }));
    else result.warnings.push(`Skipped unsupported file: ${path}`);
  }
  for (const file of files) {
    if (file.size > MAX_TOTAL) throw new Error(`${file.name} exceeds 50 MB.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name)) for (const entry of await readZip(bytes)) await add(entry.name, entry.data as Uint8Array);
    else if (/\.pdf$/i.test(file.name)) {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      const task = pdfjs.getDocument({ data: bytes }); const pdf = await task.promise;
      try {
        if (pdf.numPages > 200) throw new Error('PDF exceeds 200 pages.');
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) { const page = await pdf.getPage(i); const text = await page.getTextContent(); pages.push(text.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('')); }
        result.documents.push({ path: file.name.replace(/\.pdf$/i, '.md'), content: pages.join('\n\n') });
        result.warnings.push(`${file.name}: text extracted; layout and images are not imported. Scanned PDFs need OCR.`);
      } finally { await task.destroy(); }
    } else if (/\.docx$/i.test(file.name)) {
      const entries = await readZip(bytes), document = entries.find((e) => e.name === 'word/document.xml');
      if (!document) throw new Error('DOCX has no document text.');
      const xml = new DOMParser().parseFromString(new TextDecoder().decode(document.data as Uint8Array), 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('Invalid DOCX XML.');
      const paragraphs = Array.from(xml.getElementsByTagNameNS('*', 'p')).map((p) => Array.from(p.getElementsByTagNameNS('*', 't')).map((t) => t.textContent || '').join(''));
      result.documents.push({ path: file.name.replace(/\.docx$/i, '.md'), content: paragraphs.join('\n\n') });
      result.warnings.push(`${file.name}: text extracted; review formatting. Embedded images are not imported.`);
    } else await add(file.name, bytes);
  }
  const paths = [...result.documents.map((f) => f.path), ...result.images.map((f) => f.name)];
  if (new Set(paths).size !== paths.length) throw new Error('Duplicate import paths. Rename conflicting source files before importing.');
  return result;
}
