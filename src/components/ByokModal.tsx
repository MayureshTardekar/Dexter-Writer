import { useState } from 'react';
import { PROVIDERS, resolveProvider } from '../lib/aiGateway';
import { vaultDelete } from '../lib/vault';
import {
  customKeyName,
  customProviderId,
  deleteCustomProvider,
  loadCustomProviders,
  normalizeBaseUrl,
  saveCustomProvider,
  testCustomEndpoint,
  validateCustomProvider,
  type CustomProvider,
} from '../lib/customProviders';
import ModalHeader from './ModalHeader';

interface Props {
  provider: string;
  setProvider: (p: string) => void;
  model: string;
  setModel: (m: string) => void;
  baseUrl: string;
  setBaseUrl: (u: string) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  saveKey: (k: string) => Promise<void>;
  onClose: () => void;
}

const NEW_SENTINEL = '__new_custom__';

interface TestState {
  phase: 'testing' | 'ok' | 'err';
  message: string;
  models: string[];
}

export default function ByokModal({ provider, setProvider, model, setModel, baseUrl, setBaseUrl, apiKey, setApiKey, saveKey, onClose }: Props) {
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customs, setCustoms] = useState<CustomProvider[]>(() => loadCustomProviders());
  const [editing, setEditing] = useState<{ id?: string; name: string; baseUrl: string; model: string; noKey: boolean } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState | null>(null);
  const [testing, setTesting] = useState(false);

  const info = resolveProvider(provider);
  const isCustom = provider.startsWith('custom:');
  const hasBaseUrl = Boolean(info.defaultBaseUrl);

  function applyProvider(id: string, m?: string, b?: string) {
    setProvider(id);
    if (m !== undefined) {
      setModel(m);
      try { localStorage.setItem('dexter-write:model', m); } catch { /* ignore */ }
    }
    if (b !== undefined) {
      setBaseUrl(b);
      try { localStorage.setItem('dexter-write:baseUrl', b); } catch { /* ignore */ }
    }
  }

  function onSelectProvider(value: string) {
    if (value === NEW_SENTINEL) {
      setEditing({ name: '', baseUrl: '', model: '', noKey: false });
      setEditError(null);
      setTest(null);
      return;
    }
    const builtin = PROVIDERS.find((p) => p.id === value);
    if (builtin) {
      applyProvider(builtin.id, builtin.defaultModel, builtin.defaultBaseUrl);
      return;
    }
    const custom = customs.find((c) => c.id === value);
    if (custom) {
      applyProvider(custom.id, custom.model, custom.baseUrl);
    }
  }

  function openEditExisting() {
    const custom = customs.find((c) => c.id === provider);
    if (!custom) return;
    setEditing({ id: custom.id, name: custom.name, baseUrl: custom.baseUrl, model: custom.model, noKey: !!custom.noKey });
    setEditError(null);
    setTest(null);
  }

  async function saveEditing() {
    if (!editing) return;
    const err = validateCustomProvider(editing.name, editing.baseUrl, editing.model);
    if (err) {
      setEditError(err);
      return;
    }
    const def: CustomProvider = {
      id: editing.id ?? customProviderId(editing.name),
      name: editing.name.trim(),
      baseUrl: normalizeBaseUrl(editing.baseUrl),
      model: editing.model.trim(),
      noKey: editing.noKey,
      createdAt: Date.now(),
    };
    const all = saveCustomProvider(def);
    setCustoms(all);
    setEditing(null);
    setEditError(null);
    applyProvider(def.id, def.model, def.baseUrl);
    if (!editing.id) setApiKey('');
    setTest(null);
  }

  function removeCustom(id: string) {
    const all = deleteCustomProvider(id);
    setCustoms(all);
    vaultDelete(customKeyName(id));
    if (provider === id) {
      applyProvider(PROVIDERS[0].id, PROVIDERS[0].defaultModel, PROVIDERS[0].defaultBaseUrl);
      setApiKey('');
    }
    if (editing?.id === id) setEditing(null);
  }

  async function runTest() {
    const url = editing ? editing.baseUrl : baseUrl;
    if (!normalizeBaseUrl(url)) {
      setTest({ phase: 'err', message: 'Enter a base URL first.', models: [] });
      return;
    }
    setTesting(true);
    setTest({ phase: 'testing', message: 'Contacting endpoint…', models: [] });
    const res = await testCustomEndpoint(url, apiKey);
    setTesting(false);
    if (res.ok) {
      setTest({
        phase: 'ok',
        message: res.models.length > 0 ? `Connected — ${res.models.length} model(s) listed.` : 'Connected (endpoint answered, no model list).',
        models: res.models,
      });
    } else {
      setTest({ phase: 'err', message: res.error || 'Connection failed.', models: [] });
    }
  }

  function fillModelFromTest(m: string) {
    if (editing) {
      setEditing({ ...editing, model: m });
    } else {
      setModel(m);
      try { localStorage.setItem('dexter-write:model', m); } catch { /* ignore */ }
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="BYOK settings">
        <ModalHeader icon="key" title="BYOK Security Vault" category="Security" sub="Keys are AES-GCM encrypted in localStorage. Requests go direct to providers — no middleman." onClose={onClose} />
        <div className="modal-body">
          <label>Provider</label>
          <select value={provider} onChange={(e) => onSelectProvider(e.target.value)}>
            <optgroup label="Built-in">
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </optgroup>
            {customs.length > 0 && (
              <optgroup label="Custom endpoints">
                {customs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            )}
            <optgroup label="Manage">
              <option value={NEW_SENTINEL}>＋ New custom endpoint…</option>
            </optgroup>
          </select>

          {editing ? (
            <>
              <label>Endpoint name</label>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder='e.g. "Together AI" or "NVIDIA NIM free"'
              />
              <label>Base URL (OpenAI-compatible)</label>
              <input
                value={editing.baseUrl}
                onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                placeholder="https://api.together.xyz/v1"
              />
              <label>Model id</label>
              <input
                value={editing.model}
                onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                placeholder="e.g. deepseek-ai/DeepSeek-V3"
              />
              <label className="switch" style={{ marginTop: '10px' }}>
                <input
                  type="checkbox"
                  checked={editing.noKey}
                  onChange={(e) => setEditing({ ...editing, noKey: e.target.checked })}
                />
                No API key needed (local server)
              </label>
              <p className="muted small">
                Works with NVIDIA NIM, Together AI, GMI Cloud, Vultr, Fireworks, Mistral, or any local
                OpenAI-compatible server (vLLM, Ollama via custom entry, LM Studio).
              </p>
              {editError && <div className="mcp-error">{editError}</div>}
              {test && (
                <div className={test.phase === 'err' ? 'mcp-error' : 'sel-chip'}>
                  <span>{test.phase === 'testing' ? 'Testing…' : test.message}</span>
                </div>
              )}
              {test?.phase === 'ok' && test.models.length > 0 && (
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {test.models.slice(0, 8).map((m) => (
                    <button key={m} className="btn xs ghost" title="Use this model" onClick={() => fillModelFromTest(m)}>
                      {m.length > 40 ? `${m.slice(0, 40)}…` : m}
                    </button>
                  ))}
                </div>
              )}
              <div className="row">
                <button className="btn" disabled={testing} onClick={runTest}>
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                <span className="spacer" />
                <button className="btn" onClick={() => { setEditing(null); setEditError(null); setTest(null); }}>Cancel</button>
                <button className="btn primary" onClick={saveEditing}>Save endpoint</button>
              </div>
            </>
          ) : (
            <>
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
              {isCustom && (
                <div className="row">
                  <button className="btn xs" onClick={openEditExisting}>Edit endpoint</button>
                  <button className="btn xs" disabled={testing} onClick={runTest}>{testing ? 'Testing…' : 'Test connection'}</button>
                  <button className="btn xs danger" onClick={() => removeCustom(provider)}>Delete endpoint</button>
                </div>
              )}
              {isCustom && test && (
                <div className={test.phase === 'err' ? 'mcp-error' : 'sel-chip'}>
                  <span>{test.phase === 'testing' ? 'Testing…' : test.message}</span>
                </div>
              )}
              {isCustom && test?.phase === 'ok' && test.models.length > 0 && (
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {test.models.slice(0, 8).map((m) => (
                    <button key={m} className="btn xs ghost" title="Use this model" onClick={() => fillModelFromTest(m)}>
                      {m.length > 40 ? `${m.slice(0, 40)}…` : m}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          {info.needsKey && !editing && <button className="btn danger" onClick={() => { vaultDelete(info.keyName); setApiKey(''); }}>Clear key</button>}
          <button className="btn" onClick={onClose}>Close</button>
          <button
            className="btn primary"
            disabled={saving || !!editing}
            onClick={async () => { setSaving(true); await saveKey(apiKey); localStorage.setItem('dexter-write:model', model); localStorage.setItem('dexter-write:provider', provider); localStorage.setItem('dexter-write:baseUrl', baseUrl); setSaving(false); onClose(); }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
