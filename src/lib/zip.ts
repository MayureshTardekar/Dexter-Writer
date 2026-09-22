// Minimal ZIP writer (stored entries, no compression) — valid archives,
// no dependency. Used for Phase 2 project-bundle export.

function crc32(data: Uint8Array): number {
  let table: Uint32Array | null = (crc32 as unknown as { _t?: Uint32Array })._t ?? null;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    (crc32 as unknown as { _t: Uint32Array })._t = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = (table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
}

function toBytes(d: string | Uint8Array): Uint8Array {
  return typeof d === 'string' ? new TextEncoder().encode(d) : d;
}

export function createZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const push = (arr: Uint8Array[]) => (u: Uint8Array) => arr.push(u);
  const w32 = (puts: (u: Uint8Array) => void, v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    puts(b);
  };
  const w16 = (puts: (u: Uint8Array) => void, v: number) => {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v & 0xffff, true);
    puts(b);
  };

  for (const e of entries) {
    const nameB = enc.encode(e.name.replace(/\\/g, '/'));
    const data = toBytes(e.data);
    const crc = crc32(data);

    const local: Uint8Array[] = [];
    const lp = push(local);
    w32(lp, 0x04034b50); // local header sig
    w16(lp, 20); w16(lp, 0x0800); w16(lp, 0); w16(lp, 0); w16(lp, 0); // version, utf8 flag, stored, times
    w32(lp, crc); w32(lp, data.length); w32(lp, data.length);
    w16(lp, nameB.length); w16(lp, 0);
    lp(nameB); lp(data);
    const localBytes = concat(local);
    chunks.push(localBytes);

    const cen: Uint8Array[] = [];
    const cp = push(cen);
    w32(cp, 0x02014b50); // central sig
    w16(cp, 20); w16(cp, 20);
    w16(cp, 0x0800); w16(cp, 0); w16(cp, 0); w16(cp, 0);
    w32(cp, crc); w32(cp, data.length); w32(cp, data.length);
    w16(cp, nameB.length); w16(cp, 0); w16(cp, 0); w16(cp, 0); w16(cp, 0);
    w32(cp, 0); w32(cp, offset);
    cp(nameB);
    central.push(concat(cen));
    offset += localBytes.length;
  }

  const centralBytes = concat(central);
  chunks.push(centralBytes);
  const centralStart = offset;
  const end: Uint8Array[] = [];
  const ep = push(end);
  w32(ep, 0x06054b50);
  w16(ep, 0); w16(ep, 0);
  w16(ep, entries.length); w16(ep, entries.length);
  w32(ep, centralBytes.length); w32(ep, centralStart);
  w16(ep, 0);
  chunks.push(concat(end));
  return concat(chunks);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function downloadZip(filename: string, entries: ZipEntry[]): void {
  const bytes = createZip(entries);
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
