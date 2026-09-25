import ModalHeader from './ModalHeader';

interface Props {
  onClose: () => void;
}

export default function ShortcutsModal({ onClose }: Props) {
  const shortcuts = [
    { key: 'Ctrl/⌘ + K', desc: 'Command palette — files, templates, layout, export, actions' },
    { key: 'Layout presets', desc: 'Toolbar icons or palette: split, focus chat / editor / preview' },
    { key: 'Pane headers', desc: 'Maximize or hide any pane; hidden panes reopen from the edge rails' },
    { key: 'Double-click divider', desc: 'Reset pane sizes to defaults' },
    { key: 'Ctrl/⌘ + S', desc: 'Project is autosaved locally to browser storage' },
    { key: 'Ctrl/⌘ + Z', desc: 'Undo manual and AI-applied edits in the editor' },
    { key: 'Ctrl/⌘ + F', desc: 'Find & replace in the active document' },
    { key: 'Enter', desc: 'Send prompt to the AI playground' },
    { key: 'Ctrl + Enter', desc: 'Insert a newline in the AI prompt box' },
    { key: 'Double-click preview', desc: 'Inverse search — jump to the source line in the editor' },
    { key: 'Esc', desc: 'Close the topmost dialog' },
    { key: 'Ctrl/⌘ + P', desc: 'Print / export the document as PDF' },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard Shortcuts">
        <ModalHeader icon="keyboard" title="Keyboard Shortcuts" sub="Quick reference for Dexter Write power features." onClose={onClose} />
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
            {shortcuts.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', fontSize: '12.5px' }}>
                <kbd>{s.key}</kbd>
                <span className="muted" style={{ textAlign: 'right' }}>{s.desc}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
