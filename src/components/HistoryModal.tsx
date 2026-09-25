import { useEffect, useState } from 'react';
import {
  deleteSnapshot,
  formatTimeAgo,
  getSnapshots,
  saveSnapshot,
  type DocSnapshot,
} from '../lib/history';
import { computeHunks, hunkLabel } from '../lib/lineDiff';
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
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
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
    await deleteSnapshot(id);
    const next = snapshots.filter((s) => s.id !== id);
    setSnapshots(next);
    if (selectedId === id) {
      setSelectedId(next[0]?.id ?? null);
    }
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
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Manual Checkpoint Form */}
        <div style={{ display: 'flex', gap: '8px', margin: '10px 0', alignItems: 'center' }}>
          <input
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            placeholder="Checkpoint note (e.g. Before refactoring section 2)"
            style={{ flex: 1 }}
            aria-label="Checkpoint note"
          />
          <button className="btn primary xs" onClick={handleCreateManual}>
            + Take Snapshot
          </button>
        </div>

        {/* Body Split */}
        <div style={{ display: 'flex', gap: '12px', flex: 1, minHeight: '340px', overflow: 'hidden' }}>
          {/* Snapshots list */}
          <div
            style={{
              width: '260px',
              borderRight: '1px solid var(--border)',
              paddingRight: '10px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {loading && <p className="muted small">Loading checkpoints…</p>}
            {!loading && snapshots.length === 0 && (
              <div className="muted small" style={{ padding: '20px 0', textAlign: 'center' }}>
                No snapshots yet. Take a snapshot or let the AI auto-save checkpoints.
              </div>
            )}
            {snapshots.map((s) => {
              const isSel = s.id === selectedId;
              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: isSel ? 'var(--bubble-u)' : 'var(--panel2)',
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: isSel ? 'var(--accent)' : 'transparent',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '12.5px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {s.label}
                    </strong>
                    <button
                      className="btn xs ghost icon-btn"
                      style={{ color: 'var(--danger)' }}
                      title="Delete snapshot"
                      aria-label={`Delete snapshot ${s.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(s.id);
                      }}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                  <div className="muted" style={{ fontSize: '11px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{formatTimeAgo(s.timestamp)}</span>
                    <span>{s.words} words</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Snapshot inspection & diff */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {selected ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span className="small">
                    Selected: <strong>{selected.label}</strong> ({new Date(selected.timestamp).toLocaleTimeString()})
                    {diffHunks.length === 0 ? ' · (Identical to current)' : ` · ${diffHunks.length} change chunk(s)`}
                  </span>
                  <button
                    className="btn primary xs"
                    onClick={() => {
                      if (confirmRestore === selected.id) {
                        onRestore(selected.content);
                        onClose();
                      } else {
                        setConfirmRestore(selected.id);
                        setTimeout(() => setConfirmRestore((c) => (c === selected.id ? null : c)), 3500);
                      }
                    }}
                  >
                    {confirmRestore === selected.id ? 'Click again to confirm restore' : 'Restore Version'}
                  </button>
                </div>

                <div
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    background: 'var(--panel2)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '10px',
                    fontFamily: 'ui-monospace, Consolas, monospace',
                    fontSize: '12px',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {diffHunks.length === 0 ? (
                    selected.content
                  ) : (
                    <div>
                      <div className="muted small" style={{ marginBottom: '8px' }}>
                        Diff preview against current document (green = snapshot version, red = current):
                      </div>
                      {diffHunks.map((h, i) => (
                        <div key={i} className={`hunk ${h.kind} on`} style={{ marginBottom: '8px' }}>
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
              <div className="muted small" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                Select a checkpoint on the left to preview changes
              </div>
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
