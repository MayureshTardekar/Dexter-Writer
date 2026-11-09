import { useState } from 'react';
import { getLambdaUrl, setLambdaUrl } from '../lib/latexEngine';
import Icon, { type IconName } from './icons';

type Theme = 'light' | 'dark';

interface Props {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  aiCompletion: boolean;
  onAiCompletion: (enabled: boolean) => void;
  provider: string;
  onProviders: () => void;
  onConnections: () => void;
  onCloud: () => void;
  onGitHub: () => void;
  onShortcuts: () => void;
}

function SettingsLink({ label, description, icon, onClick }: { label: string; description: string; icon: IconName; onClick: () => void }) {
  return (
    <button type="button" className="btn ghost settings-link" onClick={onClick} aria-label={label}>
      <Icon name={icon} size={16} />
      <span><strong>{label}</strong><small>{description}</small></span>
      <Icon name="chevron" size={13} className="settings-chevron" />
    </button>
  );
}

export default function WorkspaceSettings({
  theme, onTheme, aiCompletion, onAiCompletion, provider, onProviders, onConnections, onCloud, onGitHub, onShortcuts,
}: Props) {
  const [compilerUrl, setCompilerUrl] = useState(() => getLambdaUrl() || '');
  const [compilerFeedback, setCompilerFeedback] = useState<{ text: string; error: boolean } | null>(null);

  function saveCompilerPreference(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = compilerUrl.trim();
    try {
      if (url && !['http:', 'https:'].includes(new URL(url).protocol)) throw new Error();
    } catch {
      setCompilerFeedback({ text: 'Enter a valid HTTP or HTTPS compiler URL.', error: true });
      return;
    }
    setLambdaUrl(url || null);
    setCompilerFeedback({ text: 'Compiler preference saved.', error: false });
  }

  return (
    <div className="settings-content">
      <section className="settings-section">
        <h3>AI providers</h3>
        <SettingsLink label="Models and API keys" description={provider} icon="key" onClick={onProviders} />
        <label className="settings-check">
          <input type="checkbox" aria-label="Inline AI completion" aria-describedby="inline-ai-help" checked={aiCompletion} onChange={(event) => onAiCompletion(event.target.checked)} />
          <span><strong>Inline AI completion</strong><small id="inline-ai-help">Suggest text as you type using your selected model.</small></span>
        </label>
      </section>
      <section className="settings-section">
        <h3>Integrations</h3>
        <SettingsLink label="Connections" description="AI clients, the local bridge, and custom MCP servers" icon="plug" onClick={onConnections} />
        <SettingsLink label="GitHub sync" description="Connect and sync a repository" icon="github" onClick={onGitHub} />
      </section>
      <section className="settings-section">
        <h3>Account &amp; sync</h3>
        <SettingsLink label="Cloud sync" description="Manage your account and cloud projects" icon="cloud" onClick={onCloud} />
      </section>
      <section className="settings-section">
        <h3>Appearance</h3>
        <div className="seg" role="group" aria-label="Theme">
          <button type="button" aria-pressed={theme === 'light'} onClick={() => onTheme('light')}><Icon name="sun" size={13} /> Light</button>
          <button type="button" aria-pressed={theme === 'dark'} onClick={() => onTheme('dark')}><Icon name="moon" size={13} /> Dark</button>
        </div>
      </section>
      <section className="settings-section">
        <h3>Workspace</h3>
        <SettingsLink label="Keyboard shortcuts" description="Editor and workspace commands" icon="keyboard" onClick={onShortcuts} />
        <details className="compiler-settings">
          <summary>LaTeX compiler</summary>
          <p className="muted small">Cloud compilation sends the document source and referenced files to this address.</p>
          <form className="settings-compiler-form" onSubmit={saveCompilerPreference}>
            <label htmlFor="compiler-url">Cloud compiler URL</label>
            <input id="compiler-url" value={compilerUrl} placeholder="Optional compiler address" onChange={(event) => setCompilerUrl(event.target.value)} />
            <button type="submit" className="btn xs">Save compiler preference</button>
          </form>
          {compilerFeedback && <p className={compilerFeedback.error ? 'error small' : 'muted small'} role={compilerFeedback.error ? 'alert' : 'status'}>{compilerFeedback.text}</p>}
        </details>
      </section>
    </div>
  );
}
