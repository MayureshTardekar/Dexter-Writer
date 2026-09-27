import { useState } from 'react';
import { PROVIDERS, type ProviderId } from '../lib/aiGateway';
import { vaultDelete } from '../lib/vault';
import ModalHeader from './ModalHeader';

interface Props {
  provider: ProviderId;
  setProvider: (p: ProviderId) => void;
  model: string;
  setModel: (m: string) => void;
  baseUrl: string;
  setBaseUrl: (u: string) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  saveKey: (k: string) => Promise<void>;
  onClose: () => void;
}

export default function ByokModal({ provider, setProvider, model, setModel, baseUrl, setBaseUrl, apiKey, setApiKey, saveKey, onClose }: Props) {
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const info = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];
  const hasBaseUrl = Boolean(info.defaultBaseUrl || provider === 'ollama');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="BYOK settings">
        <ModalHeader icon="key" title="BYOK Security Vault" category="Security" sub="Keys are AES-GCM encrypted in localStorage. Requests go direct to providers — no middleman." onClose={onClose} />
        <div className="modal-body">
        <label>Provider</label>
        <select
          value={provider}
          onChange={(e) => {
            const next = e.target.value as ProviderId;
            setProvider(next);
            const d = PROVIDERS.find((p) => p.id === next) ?? PROVIDERS[0];
            setModel(d.defaultModel);
            if (d.defaultBaseUrl) {
              setBaseUrl(d.defaultBaseUrl);
            }
          }}
        >
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <label>Model</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={info.defaultModel} />
        {hasBaseUrl && (
          <>
            <label>Base URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={info.defaultBaseUrl || 'http://localhost:11434/v1'}
            />
          </>
        )}
        {info.needsKey && (
          <>
            <label>API Key</label>
            <div className="row">
              <input type={show ? 'text' : 'password'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={info.help} />
              <button className="btn" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
            </div>
          </>
        )}
        <p className="muted small">{info.help}</p>
        </div>
        <div className="modal-foot">
          {info.needsKey && <button className="btn danger" onClick={() => { vaultDelete(info.keyName); setApiKey(''); }}>Clear key</button>}
          <button className="btn" onClick={onClose}>Close</button>
          <button
            className="btn primary"
            disabled={saving}
            onClick={async () => { setSaving(true); await saveKey(apiKey); localStorage.setItem('dexter-write:model', model); localStorage.setItem('dexter-write:provider', provider); localStorage.setItem('dexter-write:baseUrl', baseUrl); setSaving(false); onClose(); }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
