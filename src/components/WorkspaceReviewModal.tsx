import { ProjectContext, useProjectRuntime } from '../lib/projectRuntime';
import type { ProjectFile } from '../lib/projectFiles';
import { useMemo, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { applyHunks, computeHunks, hunkLabel, type DiffHunk } from '../lib/lineDiff';
import { registerTypstLanguage, monacoLanguageFor } from '../lib/monacoTypst';
import { registerLatexLanguage } from '../lib/monacoLatex';
import { DEXTER_DARK_THEME, DEXTER_LIGHT_THEME, MONACO_FONT, registerDexterThemes } from '../lib/monacoTheme';
import { askConfirm } from '../lib/dialog';
import ModalHeader from './ModalHeader';
import PreviewPane from './PreviewPane';
import {
  describeConflicts,
  resolveReviewedWorkspace,
  type StagedWorkspace,
  type WorkspaceApplyResult,
  type WorkspaceConflict,
} from '../lib/aiWorkspace';

export interface WorkspaceReviewDraft {
  signature: string;
  selectedKey: string;
  accepted: Record<string, number[]>;
  tab: 'code' | 'preview';
}

interface Props {
  workspace: StagedWorkspace;
  theme: 'dark' | 'light';
  conflicts?: WorkspaceConflict[];
  initialDraft?: WorkspaceReviewDraft | null;
  onApply: (workspace: StagedWorkspace) => WorkspaceApplyResult;
  onClose: (draft?: WorkspaceReviewDraft) => void;
  onDiscard: () => void;
}

function signatureFor(workspace: StagedWorkspace): string {
  return workspace.changes
    .map((change) => `${change.key}\u0000${change.name}\u0000${change.after}`)
    .join('\u0001');
}

function changedHunks(hunks: DiffHunk[]): DiffHunk[] {
  return hunks.filter((hunk) => hunk.kind !== 'equal');
}

function hunkStats(hunks: DiffHunk[]): string {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    added += hunk.newLines.length;
    removed += hunk.origLines.length;
  }
  return `+${added} / -${removed}`;
}

export default function WorkspaceReviewModal({
  workspace,
  theme,
  conflicts = [],
  initialDraft,
  onApply,
  onClose,
  onDiscard,
}: Props) {
  const runtime = useProjectRuntime();
  const hunksByKey = useMemo(() => {
    const out: Record<string, DiffHunk[]> = {};
    for (const change of workspace.changes) {
      out[change.key] = computeHunks(change.before ?? '', change.after);
    }
    return out;
  }, [workspace]);
  const signature = useMemo(() => signatureFor(workspace), [workspace]);
  const draft = initialDraft?.signature === signature ? initialDraft : null;

  const [selectedKey, setSelectedKey] = useState(draft?.selectedKey ?? workspace.changes[0]?.key ?? '');
  const [acceptedByKey, setAcceptedByKey] = useState<Record<string, Set<number>>>(() => {
    const out: Record<string, Set<number>> = {};
    for (const change of workspace.changes) {
      const hunks = changedHunks(hunksByKey[change.key] ?? []);
      const saved = draft?.accepted[change.key];
      out[change.key] = new Set(
        saved
          ? saved.filter((id) => hunks.some((hunk) => hunk.id === id))
          : hunks.map((hunk) => hunk.id),
      );
    }
    return out;
  });
  const [tab, setTab] = useState<'code' | 'preview'>(draft?.tab ?? 'preview');
  const [failure, setFailure] = useState<WorkspaceConflict[]>([]);
  const [applying, setApplying] = useState(false);

  const selected = workspace.changes.find((change) => change.key === selectedKey) ?? workspace.changes[0];
  const selectedHunks = selected ? hunksByKey[selected.key] ?? [] : [];
  const selectedChanges = changedHunks(selectedHunks);
  const accepted = selected ? acceptedByKey[selected.key] ?? new Set<number>() : new Set<number>();
  const preview = selected ? applyHunks(selected.before ?? '', selectedHunks, accepted) : '';
  const visibleConflicts = failure.length > 0 ? failure : conflicts;

  function closeWithDraft() {
    const accepted: Record<string, number[]> = {};
    for (const [key, ids] of Object.entries(acceptedByKey)) accepted[key] = [...ids];
    onClose({ signature, selectedKey: selected?.key ?? '', accepted, tab });
  }

  function toggle(id: number) {
    if (!selected) return;
    setAcceptedByKey((prev) => {
      const next = new Set(prev[selected.key] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [selected.key]: next };
    });
  }

  function setAllForSelected(acceptAll: boolean) {
    if (!selected) return;
    setAcceptedByKey((prev) => ({
      ...prev,
      [selected.key]: acceptAll ? new Set(selectedChanges.map((hunk) => hunk.id)) : new Set<number>(),
    }));
  }

  const resolved = useMemo(() => {
    const contents: Record<string, string> = {};
    for (const change of workspace.changes) {
      const acceptedIds = acceptedByKey[change.key] ?? new Set<number>();
      contents[change.key] = applyHunks(change.before ?? '', hunksByKey[change.key] ?? [], acceptedIds);
    }
    return resolveReviewedWorkspace(workspace, contents);
  }, [workspace, hunksByKey, acceptedByKey]);

  const totalAccepted = workspace.changes.reduce((sum, change) => {
    return sum + (acceptedByKey[change.key]?.size ?? 0);
  }, 0);
  const totalChanges = workspace.changes.reduce((sum, change) => {
    return sum + changedHunks(hunksByKey[change.key] ?? []).length;
  }, 0);

  return (
    <div className="modal-backdrop" onClick={closeWithDraft}>
      <div className="modal xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Review AI workspace changes">
        <ModalHeader
          icon="fileText"
          title="Review AI changes"
          category="Workspace"
          sub={`${workspace.changes.length} file${workspace.changes.length === 1 ? '' : 's'} · ${totalAccepted}/${totalChanges} chunks accepted · nothing is applied until you approve`}
          onClose={closeWithDraft}
        />
        <div className="modal-body">
          <div className="review-file-tabs">
            {workspace.changes.map((change) => {
              const hunks = changedHunks(hunksByKey[change.key] ?? []);
              const isSelected = change.key === selected?.key;
              const acceptedCount = acceptedByKey[change.key]?.size ?? 0;
              return (
                <button
                  key={change.key}
                  className={`btn xs ${isSelected ? 'primary' : 'ghost'}`}
                  onClick={() => setSelectedKey(change.key)}
                  title={`${change.name} · ${hunkStats(hunks)}`}
                >
                  {change.before === null ? '+ ' : ''}{change.name}
                  <span className="review-file-count">{acceptedCount}/{hunks.length}</span>
                </button>
              );
            })}
          </div>

          {visibleConflicts.length > 0 && (
            <div className="chat-notice" role="alert" style={{ marginBottom: '8px' }}>
              Cannot apply because {describeConflicts(visibleConflicts)}. Nothing was overwritten. Discard and retry after reviewing the file.
            </div>
          )}

          {selected && (
            <>
              <div className="seg diff-tabs" role="group" aria-label="Review view">
                <button className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}>Code diff</button>
                <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Rendered preview</button>
              </div>
              <div className="diff-body">
                {tab === 'code' ? (
                  <div className="diff-editor-wrap">
                    <DiffEditor
                      height="100%"
                      language={monacoLanguageFor(selected.mode)}
                      original={selected.before ?? ''}
                      modified={preview}
                      theme={theme === 'dark' ? DEXTER_DARK_THEME : DEXTER_LIGHT_THEME}
                      beforeMount={(monaco) => {
                        registerTypstLanguage(monaco);
                        registerLatexLanguage(monaco);
                        registerDexterThemes(monaco);
                      }}
                      options={{ renderSideBySide: true, minimap: { enabled: false }, readOnly: true, fontFamily: MONACO_FONT, fontSize: 13, lineHeight: 20, bracketPairColorization: { enabled: true }, wordWrap: 'on', scrollBeyondLastLine: false }}
                    />
                  </div>
                ) : (
                  <div className="diff-preview-wrap" title="Live render of the accepted chunks">
                    <ProjectContext.Provider value={{ ...runtime, files: [
                      ...runtime.files.filter((file) => !workspace.changes.some((change) => change.fileId === file.id || change.name === file.name)),
                      ...workspace.changes.map((change): ProjectFile => ({ id: change.fileId || change.key, name: change.name, mode: change.mode, content: change.key === selected.key ? preview : applyHunks(change.before ?? '', hunksByKey[change.key] ?? [], acceptedByKey[change.key] ?? new Set()), updatedAt: workspace.startedAt })),
                    ] }}><PreviewPane content={preview} mode={selected.mode} theme={theme} fileName={selected.name} /></ProjectContext.Provider>
                  </div>
                )}
                <aside className="hunk-list">
                  <div className="muted small" style={{ marginBottom: '6px' }}>
                    {selected.name} · {selected.before === null ? 'new file' : 'edit'} · {hunkStats(selectedChanges)}
                  </div>
                  {selectedChanges.length === 0 && <span className="muted small">No changes.</span>}
                  {selectedChanges.map((hunk) => {
                    const on = accepted.has(hunk.id);
                    return (
                      <div key={hunk.id} className={`hunk ${hunk.kind} ${on ? 'on' : 'off'}`}>
                        <label>
                          <input type="checkbox" checked={on} onChange={() => toggle(hunk.id)} />
                          <span className="hunk-label">{hunkLabel(hunk)}</span>
                        </label>
                        <pre className="hunk-pre orig">{hunk.origLines.slice(0, 6).join('\n').slice(0, 600)}</pre>
                        <pre className="hunk-pre new">{hunk.newLines.slice(0, 6).join('\n').slice(0, 600)}</pre>
                      </div>
                    );
                  })}
                  <div className="row">
                    <button className="btn xs" onClick={() => setAllForSelected(true)}>Accept all</button>
                    <button className="btn xs" onClick={() => setAllForSelected(false)}>Reject all</button>
                  </div>
                </aside>
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => { void askConfirm({ title: 'Discard all staged changes?', message: 'Every staged edit from this AI run is removed. Nothing in the project has been changed yet.', confirmLabel: 'Discard changes', danger: true }).then((ok) => { if (ok) onDiscard(); }); }}>Discard all</button>
          <button className="btn" onClick={closeWithDraft}>Review later</button>
          <button
            className="btn primary"
            disabled={resolved.changes.length === 0 || applying}
            onClick={() => {
              setApplying(true);
              const result = onApply(resolved);
              if (!result.ok) {
                setFailure(result.conflicts);
                setApplying(false);
              }
            }}
          >
            Apply {resolved.changes.length} file{resolved.changes.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
