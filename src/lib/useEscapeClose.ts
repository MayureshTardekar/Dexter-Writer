import { useEffect, useRef } from 'react';

interface EscapeEntry {
  close: () => void;
}

const stack: EscapeEntry[] = [];
let listening = false;

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  event.preventDefault();
  top.close();
}

function startListening() {
  if (listening || typeof window === 'undefined') return;
  window.addEventListener('keydown', onKeyDown);
  listening = true;
}

function stopListening() {
  if (!listening || stack.length > 0 || typeof window === 'undefined') return;
  window.removeEventListener('keydown', onKeyDown);
  listening = false;
}

export function useEscapeClose(onClose: () => void, enabled = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const entry: EscapeEntry = { close: () => closeRef.current() };
    stack.push(entry);
    startListening();
    return () => {
      const index = stack.lastIndexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      stopListening();
    };
  }, [enabled]);
}
