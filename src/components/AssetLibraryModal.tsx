import { useState } from 'react';
import type { ImageOptions, ProjectAsset } from '../lib/assets';
import { useProjectRuntime } from '../lib/projectRuntime';
import { askConfirm } from '../lib/dialog';
import Icon from './icons';
import ModalHeader from './ModalHeader';

interface Props {
  onClose: () => void; onUpload: (files: File[]) => Promise<void>;
  onInsert: (asset: ProjectAsset, options: ImageOptions) => void;
  onRename: (asset: ProjectAsset, path: string) => Promise<void>;
  onDelete: (asset: ProjectAsset) => Promise<void>;
  shared: string[]; onShare: (ids: string[]) => void;
}
export default function AssetLibraryModal({ onClose, onUpload, onInsert, onRename, onDelete, shared, onShare }: Props) {
  const runtime = useProjectRuntime();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<ImageOptions>({ alt: '', caption: '', width: 60, align: 'center' });
  const asset = runtime.assets.find((a) => a.id === selected);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  return <div className="modal-backdrop"><section className="modal xl" role="dialog" aria-modal="true" aria-label="Images and attachments">
    <ModalHeader title="Images and attachments" category="Project" icon="image" onClose={onClose} />
    <div className="modal-body asset-library" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void run(() => onUpload(Array.from(e.dataTransfer.files))); }}>
      <div className="asset-toolbar">
        <label className="asset-search">
          <Icon name="search" size={14} />
          <input aria-label="Find image" placeholder="Search images" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="btn"><Icon name="image" size={14} /> Upload images<input aria-label="Upload images" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden disabled={busy} onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void run(() => onUpload(files)); }} /></label>
      </div>
      <p className="muted small asset-hint">{runtime.assets.length} images · {(runtime.assets.reduce((n, a) => n + a.size, 0) / 1024 / 1024).toFixed(1)} MB stored on this device. Drop images here or paste one into the editor; the project ZIP includes them for backup.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="asset-grid">{runtime.assets.filter((a) => a.path.toLowerCase().includes(search.toLowerCase())).map((a) => <button key={a.id} className={`asset-card ${selected === a.id ? 'selected' : ''}`} onClick={() => { setSelected(a.id); setPath(a.path); setOptions((prev) => ({ ...prev, alt: a.name })); }}>
        <img src={runtime.urls[a.path]} alt={a.name} /><span>{a.path}</span><small>{a.width} × {a.height}</small>
      </button>)}</div>
      {!runtime.assets.length && <div className="empty-state"><Icon name="image" size={22} /><strong>No images yet</strong><span>Upload a PNG or JPEG to start building your project library.</span></div>}
      {asset && <div className="asset-options">
        <label>Project path<input value={path} onChange={(e) => setPath(e.target.value)} /></label>
        <button className="btn xs" disabled={busy || path === asset.path} onClick={() => void run(() => onRename(asset, path))}>Rename / move</button>
        <label>Alt text<input value={options.alt} onChange={(e) => setOptions({ ...options, alt: e.target.value })} /></label>
        <label>Caption<input value={options.caption} onChange={(e) => setOptions({ ...options, caption: e.target.value })} /></label>
        <div className="row"><label>Width (%)<input type="number" min={5} max={100} value={options.width} onChange={(e) => setOptions({ ...options, width: Number(e.target.value) })} /></label>
          <label>Alignment<select value={options.align} onChange={(e) => setOptions({ ...options, align: e.target.value as ImageOptions['align'] })}><option>left</option><option>center</option><option>right</option></select></label></div>
        <div className="row"><button className="btn primary" disabled={busy} onClick={() => { onInsert(asset, options); }}>Insert into {runtime.activeName}</button>
          <button className="btn danger" disabled={busy} onClick={() => { void askConfirm({ title: `Delete ${asset.path}?`, message: 'Existing references will show a missing-image warning.', confirmLabel: 'Delete image', danger: true }).then((ok) => { if (ok) void run(() => onDelete(asset)); }); }}>Delete image</button></div>
        <label className="row"><input type="checkbox" checked={shared.includes(asset.id)} onChange={(e) => onShare(e.target.checked ? [...shared, asset.id] : shared.filter((id) => id !== asset.id))} /> Share this image with the selected AI provider on my next request</label>
        <p className="muted small">Insertion never sends the image to AI. Sharing provides it as reference and does not insert it. Check the provider’s image support in AI Settings.</p>
      </div>}
    </div><div className="modal-foot"><button className="btn" onClick={onClose}>Close</button></div>
  </section></div>;
}
