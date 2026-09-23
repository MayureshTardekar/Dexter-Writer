import { useEffect, useMemo, useRef, useState } from 'react';
import Icon, { type IconName } from './icons';

export interface PaletteAction {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void;
}

export default function CommandPalette({ open, onClose, actions }: { open: boolean; onClose: () => void; actions: PaletteAction[] }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions.slice(0, 60);
    return actions.filter((a) => `${a.group} ${a.label}`.toLowerCase().includes(q)).slice(0, 60);
  }, [actions, query ]);

  useEffect(() => setIndex(0), [query ]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [index ]);

  if (!open) return null;

  function choose(i: number) {
    const a = filtered[i];
    if (!a) return;
    onClose();
    // Defer so the palette unmounts before heavy actions (e.g. Monaco diff).
    setTimeout(() => a.run(), 0);
  }

  let lastGroup = '';
  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="palette-input-row">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(filtered.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); choose(index); }
              else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
            placeholder="Type a command or search files…"
            aria-label="Command search"
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="palette-empty muted">No matching commands</div>}
          {filtered.map((a, i) => {
            const header = a.group !== lastGroup ? a.group : null;
            lastGroup = a.group;
            return (
              <div key={a.id}>
                {header && <div className="palette-group">{header}</div>}
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                <div
                  data-idx={i}
                  className={`palette-item ${i === index ? 'active' : ''}`}
                  onClick={() => choose(i)}
                  onMouseEnter={() => setIndex(i)}
                >
                  <Icon name={a.icon} size={14} />
                  <span className="palette-label">{a.label}</span>
                  {a.hint && <kbd>{a.hint}</kbd>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
