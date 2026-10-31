import { useEffect, useState } from 'react';
import { resolveDialog, subscribeDialog, type DialogRequest } from '../lib/dialog';
import ModalHeader from './ModalHeader';

export default function DialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [input, setInput] = useState('');

  useEffect(() => subscribeDialog(setRequest), []);
  useEffect(() => {
    if (request?.kind === 'prompt') setInput(request.defaultValue ?? '');
  }, [request?.id, request?.kind, request?.defaultValue]);

  if (!request) return null;
  const close = () => resolveDialog(null);
  const submit = () => resolveDialog(request.kind === 'prompt' ? input : 'confirmed');

  return (
    <div className="modal-backdrop" onClick={close}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); submit(); }}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}
      >
        <ModalHeader icon={request.danger ? 'alert' : 'info'} title={request.title} category="Confirm" onClose={close} />
        <div className="modal-body">
          <p className="dialog-message">{request.message}</p>
          {request.kind === 'prompt' && (
            <label className="dialog-field">
              <span>{request.inputLabel ?? 'Value'}</span>
              <input
                autoFocus
                value={input}
                placeholder={request.placeholder}
                onChange={(event) => setInput(event.target.value)}
              />
            </label>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={close} autoFocus={request.danger}>
            {request.cancelLabel}
          </button>
          <button type="submit" className={`btn ${request.danger ? 'danger' : 'primary'}`} autoFocus={!request.danger && request.kind === 'confirm'}>
            {request.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
