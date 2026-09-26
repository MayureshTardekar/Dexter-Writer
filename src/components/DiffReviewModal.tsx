import { useMemo, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { applyHunks, computeHunks, hunkLabel } from '../lib/lineDiff';
import { registerTypstLanguage } from '../lib/monacoTypst';
import { DEXTER_DARK_THEME, DEXTER_LIGHT_THEME, MONACO_FONT, registerDexterThemes } from '../lib/monacoTheme';
import ModalHeader from './ModalHeader';
import PreviewPane from './PreviewPane';
import type { DocMode } from '../lib/templates';

interface Props {
  summary: string;
  before: string;
  after: string;
  language: string;
  mode: DocMode;
  theme: 'dark' | 'light';
  onAccept: (finalContent: string) => void;
  onClose: () => void;
}

/** Phase 2: side-by-side Monaco diff with per-chunk Accept/Reject + rendered preview. */
export default function DiffReviewModal({ summary, before, after, language, mode, theme, onAccept, onClose }: Props) {
  const hunks = useMemo(() => computeHunks(before, after), [before, after]);
  const changeHunks = useMemo(() => hunks.filter((h) => h.kind !== 'equal'), [hunks]);
  const [accepted, setAccepted] = useState<Set<number>>(() => new Set(changeHunks.map((h) => h.id)));
  const [tab, setTab] = useState<'code' | 'preview'>('preview');
  const preview = useMemo(() => applyHunks(before, hunks, accepted), [before, hunks, accepted]);

  function toggle(id: number) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Diff review">
        <ModalHeader
          icon="fileText"
          title={summary}
          category="Review"
          sub={`${accepted.size}/${changeHunks.length} chunks accepted · green = proposed, red = current`}
          onClose={onClose}
        />
        <div className="modal-body">
        <div className="seg diff-tabs" role="group" aria-label="Review view">
          <button className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}>Code diff</button>
          <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Rendered preview</button>
        </div>
        <div className="diff-body">
          {tab === 'code' ? (
          <div className="diff-editor-wrap">
            <DiffEditor
              height="100%"
              language={language}
              original={before}
              modified={preview}
              theme={theme === 'dark' ? DEXTER_DARK_THEME : DEXTER_LIGHT_THEME}
              beforeMount={(monaco) => {
                registerTypstLanguage(monaco);
                registerDexterThemes(monaco);
              }}
              options={{ renderSideBySide: true, minimap: { enabled: false }, readOnly: true, fontFamily: MONACO_FONT, fontSize: 12.5, wordWrap: 'on', scrollBeyondLastLine: false }}
            />
          </div>
          ) : (
          <div className="diff-preview-wrap" title="Live render of the accepted chunks">
            <PreviewPane content={preview} mode={mode} theme={theme} />
          </div>
          )}
          <aside className="hunk-list">
            {changeHunks.length === 0 && <span className="muted small">No changes.</span>}
            {changeHunks.map((h) => {
              const on = accepted.has(h.id);
              return (
                <div key={h.id} className={`hunk ${h.kind} ${on ? 'on' : 'off'}`}>
                  <label>
                    <input type="checkbox" checked={on} onChange={() => toggle(h.id)} />
                    <span className="hunk-label">{hunkLabel(h)}</span>
                  </label>
                  <pre className="hunk-pre orig">{h.origLines.slice(0, 6).join('\n').slice(0, 600)}</pre>
                  <pre className="hunk-pre new">{h.newLines.slice(0, 6).join('\n').slice(0, 600)}</pre>
                </div>
              );
            })}
            <div className="row">
              <button className="btn xs" onClick={() => setAccepted(new Set(changeHunks.map((h) => h.id)))}>Accept all</button>
              <button className="btn xs" onClick={() => setAccepted(new Set())}>Reject all</button>
            </div>
          </aside>
        </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Discard</button>
          <button className="btn primary" onClick={() => onAccept(preview)}>
            Apply {accepted.size} chunk{accepted.size === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
