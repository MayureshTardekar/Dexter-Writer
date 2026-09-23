import { useState } from 'react';
import ModalHeader from './ModalHeader';

interface Props {
  initialRoom: string;
  initialPassword: string;
  initialName: string;
  busy: boolean;
  error: string | null;
  onJoin: (room: string, password: string, name: string) => void;
  onClose: () => void;
}

/** Phase 3: start/join a P2P editing room. No accounts, no database. */
export default function LiveModal({ initialRoom, initialPassword, initialName, busy, error, onJoin, onClose }: Props) {
  const [room, setRoom] = useState(initialRoom);
  const [password, setPassword] = useState(initialPassword);
  const [name, setName] = useState(initialName);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Live collaboration">
        <ModalHeader
          icon="sparkles"
          title="Live Collaboration"
          sub="Peer-to-peer via WebRTC + Yjs CRDTs. Signaling only introduces peers — document content never touches a server. Optional password enables end-to-end encryption."
          onClose={onClose}
        />
        <div className="modal-body">
        <label>Display name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Writer-ABCD" />
        <label>Room ID</label>
        <div className="row">
          <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. thesis-2026" style={{ flex: 1 }} />
          <button
            className="btn"
            onClick={() => setRoom(Math.random().toString(36).slice(2, 10))}
          >
            New
          </button>
        </div>
        <label>Room password (optional)</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Shared secret for E2E encryption" />
        {error && <div className="mcp-error">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={busy || !room.trim() || !name.trim()}
            onClick={() => onJoin(room.trim(), password, name.trim())}
          >
            {busy ? 'Connecting…' : 'Go Live'}
          </button>
        </div>
      </div>
    </div>
  );
}
