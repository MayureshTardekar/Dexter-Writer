import Icon from './icons';

interface Props {
  count: number;
  summary: string;
  onUndo: () => void;
  onDismiss: () => void;
}

export default function ExternalAgentBanner({ count, summary, onUndo, onDismiss }: Props) {
  return (
    <div className="external-agent-banner" role="status" aria-live="polite">
      <span className="external-agent-icon"><Icon name="check" size={15} /></span>
      <div className="external-agent-copy">
        <strong>MCP applied {count} file{count === 1 ? '' : 's'}</strong>
        <span>{summary} — undo is available.</span>
      </div>
      <button className="btn xs" onClick={onUndo}>
        <Icon name="undo" size={12} /> Undo
      </button>
      <button className="btn xs ghost" onClick={onDismiss} title="Dismiss applied changes notice" aria-label="Dismiss applied changes notice">
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
