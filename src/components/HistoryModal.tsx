import { useEffect, useState } from 'react';
import {
  deleteSnapshot,
  formatTimeAgo,
  getSnapshots,
  saveSnapshot,
  type DocSnapshot,
} from '../lib/history';
import { computeHunks, hunkLabel } from '../lib/lineDiff';
import { askConfirm } from '../lib/dialog';
import ModalHeader from './ModalHeader';
import Icon from './icons';

interface Props {
  fileId: string;
  fileName: string;
  currentContent: string;
  onRestore: (content: string) => void;
  onClose: () => void;
}

export default function HistoryModal({
  fileId,
  fileName,
  currentContent,
  onRestore,
  onClose,
}: Props) {
  const [snapshots, setSnapshots] = useState<DocSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  async function loadList() {
    setLoading(true);
    const list = await getSnapshots(fileId);
    setSnapshots(list);
    if (list.length > 0 && !selectedId) {
      setSelectedId(list[0].id);
    }
    setLoading(false);
  }

  async function handleCreateManual() {
    const label = customLabel.trim() || 'Manual checkpoint';
    await saveSnapshot(fileId, fileName, currentContent, label);
    setCustomLabel('');
    await loadList();
  }

  async function handleDelete(id: string) {
    const ok = await askConfirm({
      title: 'Delete this checkpoint?',
      message: 'The snapshot is removed permanently. The current document is not affected.',
      confirmLabel: 'Delete checkpoint',
      danger: true,
    });
    if (!ok) return;
    await deleteSnapshot(id);
    const next = snapshots.filter((s) => s.id !== id);
    setSnapshots(next);
    if (selectedId === id) {
      setSelectedId(next[0]?.id ?? null);
    }
  }

  async function handleRestore(content: string) {
    const ok = await askConfirm({
      title: 'Restore this version?',
      message: 'The editor content is replaced with this checkpoint. Take a snapshot first if you want to keep the current draft.',
      confirmLabel: 'Restore version',
    });
    if (!ok) return;
    onRestore(content);
    onClose();
  }

  const selected = snapshots.find((s) => s.id === selectedId);
  const diffHunks = selected
    ? computeHunks(currentContent, selected.content).filter((h) => h.kind !== 'equal')
    : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Document Revision History"
        style={{ width: '840px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        <ModalHeader
          icon="history"
          title="Document History & Snapshots"
          category="Versions"
          sub={fileName ? <>File: <strong>{fileName}</strong> · time-travel and restore previous versions</> : 'Time-travel and restore previous versions'}
          onClose={onClose}
        />
        <div className="modal-body">

        <div className="history-create">
          <input
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            placeholder="Checkpoint note (e.g. Before refactoring section 2)"
            aria-label="Checkpoint note"
          />
          <button className="btn primary xs" onClick={handleCreateManual}>
            <Icon name="plus" size={12} /> Take snapshot
          </button>
        </div>

        <div className="history-body">
          <div className="history-list">
            {loading && <p className="muted small">Loading checkpoints…</p>}
            {!loading && snapshots.length === 0 && (
              <div className="history-empty">
                No snapshots yet. Take a snapshot or let the AI auto-save checkpoints.
              </div>
            )}
            {snapshots.map((s) => {
              const isSel = s.id === selectedId;
              return (
                <div key={s.id} className={`history-item${isSel ? ' active' : ''}`} onClick={() => setSelectedId(s.id)}>
                  <div className="history-item-head">
                    <strong>{s.label}</strong>
                    <button
                      className="btn xs ghost icon-btn"
                      title="Delete snapshot"
                      aria-label={`Delete snapshot ${s.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(s.id);
                      }}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                  <div className="history-meta">
                    <span>{formatTimeAgo(s.timestamp)}</span>
                    <span>{s.words} words</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="history-inspect">
            {selected ? (
              <>
                <div className="history-inspect-head">
                  <span className="small">
                    <strong>{selected.label}</strong> · {new Date(selected.timestamp).toLocaleTimeString()}
                    {diffHunks.length === 0 ? ' · identical to current' : ` · ${diffHunks.length} change${diffHunks.length === 1 ? '' : 's'}`}
                  </span>
                  <button className="btn primary xs" onClick={() => { void handleRestore(selected.content); }}>
                    Restore version
                  </button>
                </div>

                <div className="history-preview">
                  {diffHunks.length === 0 ? (
                    selected.content
                  ) : (
                    <div>
                      <div className="history-diff-note">
                        Diff against the current document. Green is the snapshot, red is current.
                      </div>
                      {diffHunks.map((h, i) => (
                        <div key={i} className={`hunk ${h.kind} on`}>
                          <span className="hunk-label">{hunkLabel(h)}</span>
                          {h.origLines.length > 0 && (
                            <pre className="hunk-pre orig">{h.origLines.join('\n')}</pre>
                          )}
                          {h.newLines.length > 0 && (
                            <pre className="hunk-pre new">{h.newLines.join('\n')}</pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="history-placeholder">Select a checkpoint to preview changes.</div>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        </div>
      </div>
    </div>
  );
}
