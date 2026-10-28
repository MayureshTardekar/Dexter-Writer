import type { StagedWorkspace } from '../lib/aiWorkspace';
import Icon from './icons';

interface Props {
  workspace: StagedWorkspace;
  onReview: () => void;
  onDiscard: () => void;
}

export default function ExternalAgentBanner({ workspace, onReview, onDiscard }: Props) {
  const count = workspace.changes.length;
  const names = workspace.changes.map((change) => change.name).join(', ');
  return (
    <div className="external-agent-banner" role="status" aria-live="polite">
      <span className="external-agent-icon"><Icon name="plug" size={15} /></span>
      <div className="external-agent-copy">
        <strong>External agent staged {count} file{count === 1 ? '' : 's'}</strong>
        <span>{names} — nothing applied yet.</span>
      </div>
      <button className="btn xs primary" onClick={onReview}>
        <Icon name="fileText" size={12} /> Review
      </button>
      <button className="btn xs ghost" onClick={onDiscard} title="Discard staged external changes">
        <Icon name="trash" size={12} /> Discard
      </button>
    </div>
  );
}
