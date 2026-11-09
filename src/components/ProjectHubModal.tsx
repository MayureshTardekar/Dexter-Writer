import { uniqueName } from '../lib/projectFiles';
import { useState } from 'react';
import { templateCatalog, saveCustomTemplate } from '../lib/templateCatalog';
import { importFiles, type ImportedProject } from '../lib/importProject';
import { useProjectRuntime } from '../lib/projectRuntime';
import ModalHeader from './ModalHeader';
import type { DocMode } from '../lib/templates';

interface Props {
  onClose: () => void; onCreate: (name: string, mode: DocMode, content: string) => void;
  onImport: (incoming: ImportedProject, replace: boolean) => Promise<void>;
  onValidate: () => Promise<string[]>;
}
export default function ProjectHubModal({ onClose, onCreate, onImport, onValidate }: Props) {
  const runtime = useProjectRuntime();
  const [name, setName] = useState('untitled.md'), [mode, setMode] = useState<DocMode>('markdown');
  const [incoming, setIncoming] = useState<ImportedProject | null>(null);
  const [replace, setReplace] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string[] | null>(null), [templateName, setTemplateName] = useState('');
  const [templates, setTemplates] = useState(templateCatalog);
  const plannedNames: Array<{ name: string }> = replace ? [] : [...runtime.files];
  const importNames = (incoming?.documents ?? []).map((file) => { const name = uniqueName(plannedNames, file.path); plannedNames.push({ name }); return name; });
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  return <div className="modal-backdrop"><section className="modal xl" role="dialog" aria-modal="true" aria-label="Project start and import">
    <ModalHeader icon="files" title="Your writing workspace" category="Project" onClose={onClose} />
    <div className="modal-body project-hub">
      <div className="hub-actions"><button className="btn" disabled={busy} onClick={() => void run(async () => setReport(await onValidate()))}>Validate project</button></div>
      {error && <p className="error" role="alert">{error}</p>}
      {report && <div className="validation-report" role="status">{report.map((line, i) => <p key={i}>{line}</p>)}</div>}
      <h3>Create a document</h3>
      <div className="hub-form-row">
        <label className="hub-field"><span>Name</span><input aria-label="Document name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="hub-field hub-field-format"><span>Format</span><select aria-label="Document format" value={mode} onChange={(e) => { const m = e.target.value as DocMode; setMode(m); setName(`untitled.${m === 'latex' ? 'tex' : m === 'typst' ? 'typ' : 'md'}`); }}><option value="markdown">Markdown</option><option value="latex">LaTeX</option><option value="typst">Typst</option></select></label>
        <button className="btn primary" onClick={() => { try { onCreate(name, mode, ''); onClose(); } catch (e) { setError(String(e)); } }}>Create</button>
      </div>
      <h3>Import files or restore a backup</h3><p className="muted small">Markdown, LaTeX, Typst, text, ZIP, PDF text, and DOCX text. You can review every file before importing.</p>
      <label className={`file-drop${busy ? ' is-busy' : ''}`}>
        <input aria-label="Import project files" type="file" multiple accept=".md,.markdown,.tex,.typ,.txt,.zip,.pdf,.docx,.bib,.sty,.cls,.png,.jpg,.jpeg,.webp" disabled={busy} onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void run(async () => setIncoming(await importFiles(files))); }} />
        <span className="file-drop-title">Choose files to import</span>
        <span className="file-drop-hint">Markdown, LaTeX, Typst, TXT, ZIP, PDF, DOCX, images</span>
      </label>
      {incoming && <div className="import-preview"><ul>{incoming.documents.map((f, i) => <li key={`${f.path}-${i}`}>{f.path}{importNames[i] !== f.path ? ` → ${importNames[i]}` : ''} — {f.content.length.toLocaleString()} characters</li>)}{incoming.images.map((f) => <li key={f.name}>{f.name} — image</li>)}</ul>{incoming.warnings.map((w, i) => <p className="muted small" key={i}>{w}</p>)}
        <label className="row"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />Replace current documents instead of merging (download a backup first)</label><button className="btn primary" disabled={busy || !incoming.documents.length && !incoming.images.length} onClick={() => void run(async () => { await onImport(incoming, replace); setIncoming(null); onClose(); })}>{busy ? 'Importing…' : 'Import reviewed files'}</button></div>}
      <h3>New from template</h3><div className="template-grid">{templates.map((t) => <button className="template-card" key={t.id} onClick={() => { try { onCreate(`${t.id}.${t.mode === 'latex' ? 'tex' : t.mode === 'typst' ? 'typ' : 'md'}`, t.mode, t.content); onClose(); } catch (e) { setError(String(e)); } }}><strong>{t.label}</strong><small>{t.description}</small></button>)}</div>
      <h3>Save the current document as a personal template</h3>
      <div className="hub-form-row">
        <label className="hub-field"><span>Template name</span><input aria-label="Personal template name" placeholder="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} /></label>
        <button className="btn" disabled={!templateName.trim()} onClick={() => { const active = runtime.files.find((f) => f.name === runtime.activeName); if (!active) return; try { saveCustomTemplate({ label: templateName.trim(), description: 'Personal template', mode: active.mode, content: active.content }); setTemplates(templateCatalog()); setTemplateName(''); } catch (e) { setError(String(e)); } }}>Save template</button>
      </div>
    </div><div className="modal-foot"><button className="btn" onClick={onClose}>Close</button></div>
  </section></div>;
}
