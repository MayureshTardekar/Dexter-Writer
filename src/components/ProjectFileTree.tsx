import { useState } from 'react';
import type { ProjectFile } from '../lib/projectFiles';
import Icon from './icons';

interface Props { files: ProjectFile[]; activeId: string; onSelect: (id: string) => void; onDelete: (id: string) => void; onRename: (id: string) => void }
interface Node { folders: Map<string, Node>; files: ProjectFile[] }
export default function ProjectFileTree({ files, activeId, onSelect, onDelete, onRename }: Props) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const root: Node = { folders: new Map(), files: [] };
  for (const file of files) {
    let node = root;
    for (const segment of file.name.split('/').slice(0, -1)) { let child = node.folders.get(segment); if (!child) { child = { folders: new Map(), files: [] }; node.folders.set(segment, child); } node = child; }
    node.files.push(file);
  }
  function render(node: Node, prefix = '', depth = 0) {
    return <>{[...node.folders].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
      const path = prefix + name + '/';
      return <div key={path}><button className="file-item folder-item" style={{ paddingLeft: 12 + depth * 14 }} aria-expanded={!closed.has(path)} onClick={() => setClosed((prev) => { const next = new Set(prev); if (next.has(path)) next.delete(path); else next.add(path); return next; })}><Icon name="chevron" size={12} />{name}</button>{!closed.has(path) && render(child, path, depth + 1)}</div>;
    })}{node.files.sort((a, b) => a.name.localeCompare(b.name)).map((file) => <div key={file.id} className={`file-item ${file.id === activeId ? 'active' : ''}`} style={{ paddingLeft: 12 + depth * 14 }} title={file.name}>
      <button className="file-select" onClick={() => onSelect(file.id)}><Icon name="fileText" size={13} /><span className="fname">{file.name.split('/').at(-1)}</span></button>
      <button className="btn xs ghost icon-btn" aria-label={`Rename or move ${file.name}`} title="Rename or move" onClick={() => onRename(file.id)}><Icon name="edit" size={12} /></button>
      {files.length > 1 && <button className="btn xs ghost icon-btn file-del" aria-label={`Delete ${file.name}`} onClick={() => onDelete(file.id)}><Icon name="trash" size={12} /></button>}
    </div>)}</>;
  }
  return render(root);
}
