// Minimal toast bus — lets any module (even lib code) surface UI feedback
// without window.alert. Rendered by <Toasts /> in App.

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

type Listener = (t: Toast[]) => void;

let nextId = 1;
let items: Toast[] = [];
const listeners = new Set<Listener>();
let timers = new Map<number, number>();

function emit() {
  for (const l of listeners) l([...items]);
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  fn([...items]);
  return () => { listeners.delete(fn); };
}

export function toast(message: string, kind: ToastKind = 'info', ms = 4200): void {
  const id = nextId++;
  items = [...items.slice(-3), { id, message, kind }];
  emit();
  const prev = timers.get(id);
  if (prev) window.clearTimeout(prev);
  timers.set(
    id,
    window.setTimeout(() => {
      timers.delete(id);
      dismissToast(id);
    }, ms),
  );
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}
