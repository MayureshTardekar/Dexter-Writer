interface Props {
  onClose: () => void;
}

export default function ShortcutsModal({ onClose }: Props) {
  const shortcuts = [
    { key: 'Ctrl + S / ⌘ + S', desc: 'Saves project files locally to browser storage' },
    { key: 'Ctrl + Z / ⌘ + Z', desc: 'Undoes manual and AI-applied edits in editor' },
    { key: 'Ctrl + F / ⌘ + F', desc: 'Find & Replace in active document buffer' },
    { key: 'Enter', desc: 'Send prompt to AI in the playground' },
    { key: 'Ctrl + Enter', desc: 'Insert new line in AI chat prompt input' },
    { key: 'Ctrl + P / ⌘ + P', desc: 'Print / Export document as clean PDF' },
    { key: 'Zen Button', desc: 'Toggle full-width editor or live preview focus mode' },
    { key: 'Ask AI Button', desc: 'Highlight any text in editor to discuss or improve it' },
    { key: '🎙️ Mic Button', desc: 'Speech-to-text voice dictation directly into prompt' },
    { key: '🤝 Go Live', desc: 'Share encrypted P2P room link for live multiplayer editing' },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard Shortcuts">
        <h2>⌨️ Keyboard Shortcuts & Quick Guide</h2>
        <p className="muted small">Quick reference for Dexter Write power features.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '14px 0' }}>
          {shortcuts.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12.5px' }}>
              <kbd style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 6px', fontFamily: 'monospace' }}>
                {s.key}
              </kbd>
              <span className="muted" style={{ textAlign: 'right', marginLeft: '12px' }}>{s.desc}</span>
            </div>
          ))}
        </div>
        <div className="row end">
          <button className="btn primary" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}
