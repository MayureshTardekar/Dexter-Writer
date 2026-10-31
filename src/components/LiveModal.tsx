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
          icon="plug"
          title="Live Collaboration"
          category="P2P"
          sub="Peer-to-peer via WebRTC + Yjs CRDTs. Signaling only introduces peers — document content never touches a server. Optional password enables end-to-end encryption."
          onClose={onClose}
        />
        <div className="modal-body">
        <label htmlFor="live-name">Display name</label>
        <input id="live-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Writer-ABCD" autoComplete="nickname" />
        <label htmlFor="live-room">Room ID</label>
        <div className="live-room-row">
          <input id="live-room" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. thesis-2026" autoComplete="off" />
          <button
            className="btn"
            onClick={() => setRoom(Math.random().toString(36).slice(2, 10))}
            title="Generate a random room ID"
          >
            New
          </button>
        </div>
        <label htmlFor="live-password">Room password (optional)</label>
        <input id="live-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Shared secret for end-to-end encryption" autoComplete="off" />
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
