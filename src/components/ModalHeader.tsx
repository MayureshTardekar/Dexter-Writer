import type { ReactNode } from 'react';
import Icon, { type IconName } from './icons';

export default function ModalHeader({ icon, title, sub, onClose }: { icon: IconName; title: string; sub?: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-head">
      <div className="modal-title">
        <span className="modal-icon">
          <Icon name={icon} size={16} />
        </span>
        <div>
          <h2>{title}</h2>
          {sub && <p className="muted small modal-sub">{sub}</p>}
        </div>
      </div>
      <button className="btn icon-btn" onClick={onClose} aria-label="Close dialog" autoFocus={false}>
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}
