import { useEffect, useId, useRef, useState } from 'react';
import Icon, { type IconName } from './icons';

export interface ToolbarAction {
  label: string;
  icon: IconName;
  run: () => void;
  danger?: boolean;
}

interface Props {
  label: string;
  icon?: IconName;
  actions: ToolbarAction[];
  alignEnd?: boolean;
}

export default function ToolbarMenu({ label, icon, actions, alignEnd }: Props) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const contentId = useId();

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent | FocusEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [open]);

  return (
    <div
      ref={container}
      className={`toolbar-menu${alignEnd ? ' align-end' : ''}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button ref={trigger} type="button" className="btn xs" aria-expanded={open} aria-controls={contentId} aria-label={label} onClick={() => setOpen(!open)}>
        {icon && <Icon name={icon} size={14} />}
        <span className={icon ? 'btn-label optional' : undefined}>{label}</span>
        <Icon name="chevron" size={12} />
      </button>
      <div id={contentId} className="toolbar-menu-items" role="group" aria-label={`${label} actions`} hidden={!open}>
        {actions.map(({ label: actionLabel, icon: actionIcon, run, danger }) => (
          <button
            key={actionLabel}
            type="button"
            className={`btn ghost toolbar-menu-item${danger ? ' danger' : ''}`}
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
              run();
            }}
          >
            <Icon name={actionIcon} size={15} />
            {actionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}
