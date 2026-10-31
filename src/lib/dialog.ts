export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  defaultValue?: string;
  inputLabel?: string;
  placeholder?: string;
}

export interface DialogRequest {
  id: number;
  kind: 'confirm' | 'prompt';
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  defaultValue?: string;
  inputLabel?: string;
  placeholder?: string;
}

type Resolver = (value: string | null) => void;

let nextId = 1;
let current: { request: DialogRequest; resolve: Resolver } | null = null;
const listeners = new Set<(request: DialogRequest | null) => void>();

function emit() {
  for (const listener of listeners) listener(current?.request ?? null);
}

function open(options: Omit<DialogRequest, 'id' | 'confirmLabel' | 'cancelLabel' | 'danger'> & Partial<Pick<DialogRequest, 'confirmLabel' | 'cancelLabel' | 'danger'>>): Promise<string | null> {
  if (current) {
    current.resolve(null);
    current = null;
  }
  const request: DialogRequest = {
    id: nextId++,
    confirmLabel: options.confirmLabel ?? (options.kind === 'prompt' ? 'Save' : 'Confirm'),
    cancelLabel: options.cancelLabel ?? 'Cancel',
    danger: options.danger ?? false,
    ...options,
  };
  return new Promise((resolve) => {
    current = { request, resolve };
    emit();
  });
}

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return open({
    kind: 'confirm',
    ...options,
  }).then((value) => value !== null);
}

export function askPrompt(options: PromptOptions): Promise<string | null> {
  return open({
    kind: 'prompt',
    ...options,
  });
}

export function subscribeDialog(listener: (request: DialogRequest | null) => void): () => void {
  listeners.add(listener);
  listener(current?.request ?? null);
  return () => { listeners.delete(listener); };
}

export function resolveDialog(value: string | null): void {
  const pending = current;
  if (!pending) return;
  current = null;
  pending.resolve(value);
  emit();
}
