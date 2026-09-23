import { useState } from 'react';
import ModalHeader from './ModalHeader';
import Icon from './icons';
import {
  AUDIT_PRESETS,
  runDocumentAudit,
  type AuditIssue,
  type AuditPreset,
  type AuditReport,
} from '../lib/reviewAgent';
import { replaceLines } from '../lib/virtualMcp';
import { saveSnapshot } from '../lib/history';
import { toast } from '../lib/toast';
import type { ProviderId } from '../lib/aiGateway';
import type { DocMode } from '../lib/templates';

interface Props {
  content: string;
  onApplyContent: (newContent: string) => void;
  mode: DocMode;
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  fileName: string;
  fileId: string;
  onClose: () => void;
}

export default function ReviewAgentModal({
  content,
  onApplyContent,
  mode,
  provider,
  apiKey,
  baseUrl,
  model,
  fileName,
  fileId,
  onClose,
}: Props) {
  const [preset, setPreset] = useState<AuditPreset>(() => {
    if (fileName.toLowerCase().includes('resume')) return 'resume';
    if (mode === 'latex' || mode === 'typst') return 'academic';
    return 'techdoc';
  });
  const [customGoal, setCustomGoal] = useState('');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'suggestion'>('all');

  async function handleRunAudit() {
    if (provider !== 'ollama' && !apiKey) {
      toast('Please set an API key in BYOK settings first', 'error');
      return;
    }
    setRunning(true);
    try {
      const res = await runDocumentAudit(
        provider,
        { apiKey, baseUrl, model },
        content,
        mode,
        preset,
        customGoal.trim() || undefined,
      );
      setReport(res);
      setIssues(res.issues);
      toast(`Audit completed! Quality Score: ${res.score}/100`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Audit failed', 'error');
    } finally {
      setRunning(false);
    }
  }

  function handleFixSingle(issue: AuditIssue) {
    saveSnapshot(fileId, fileName, content, `Pre-Fix: ${issue.title}`).catch(() => {});
    const res = replaceLines(content, issue.startLine, issue.endLine, issue.proposedText);
    if (res.newContent !== undefined) {
      onApplyContent(res.newContent);
      setIssues((prev) =>
        prev.map((it) => (it.id === issue.id ? { ...it, applied: true } : it)),
      );
      toast(`Applied fix for lines ${issue.startLine}-${issue.endLine}`, 'success');
    } else {
      toast(res.message || 'Failed to replace lines', 'error');
    }
  }

  function handleFixAll() {
    const unapplied = issues.filter((i) => !i.applied && i.proposedText);
    if (unapplied.length === 0) return;

    saveSnapshot(fileId, fileName, content, `Pre-Audit Auto-Fix (${unapplied.length} issues)`).catch(() => {});

    // Sort issues descending by startLine to avoid line-number offset invalidation!
    const sorted = [...unapplied].sort((a, b) => b.startLine - a.startLine);
    let updated = content;
    let appliedCount = 0;

    for (const iss of sorted) {
      const res = replaceLines(updated, iss.startLine, iss.endLine, iss.proposedText);
      if (res.newContent !== undefined) {
        updated = res.newContent;
        appliedCount++;
      }
    }

    if (appliedCount > 0) {
      onApplyContent(updated);
      setIssues((prev) => prev.map((it) => ({ ...it, applied: true })));
      toast(`Successfully auto-fixed ${appliedCount} issues!`, 'success');
    }
  }

  const unappliedCount = issues.filter((i) => !i.applied).length;
  const filteredIssues = issues.filter((i) => {
    if (filter === 'all') return true;
    return i.severity === filter;
  });

  const scoreColor =
    (report?.score ?? 0) >= 85
      ? 'var(--accent2)'
      : (report?.score ?? 0) >= 70
        ? 'var(--accent)'
        : 'var(--danger)';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Autonomous Document Review Agent"
        style={{ width: '840px', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
      >
        <ModalHeader
          icon="sparkles"
          title="Autonomous Document Review Agent"
          sub={`Multi-step quality, ATS, and formula audit for ${fileName}`}
          onClose={onClose}
        />

        {/* Audit Configuration */}
        <div
          style={{
            background: 'var(--panel2)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '12px 14px',
            margin: '10px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ margin: 0, fontWeight: 600, fontSize: '12.5px' }}>Audit Profile:</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as AuditPreset)}
              style={{ flex: 1, minWidth: '180px' }}
              aria-label="Audit Profile"
            >
              {AUDIT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button className="btn primary" onClick={handleRunAudit} disabled={running}>
              {running ? (
                <>
                  <Icon name="sparkles" size={14} className="spin" /> Auditing Document…
                </>
              ) : (
                <>
                  <Icon name="sparkles" size={14} /> Run Deep Audit
                </>
              )}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span className="muted small" style={{ whiteSpace: 'nowrap' }}>Custom Priority:</span>
            <input
              value={customGoal}
              onChange={(e) => setCustomGoal(e.target.value)}
              placeholder="e.g. Focus on technical metrics, check equation 3, eliminate passive voice"
              style={{ flex: 1, fontSize: '12px' }}
              aria-label="Custom Priority"
            />
          </div>
        </div>

        {/* Audit Results View */}
        {report && (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>
            {/* Score & Summary Banner */}
            <div
              style={{
                display: 'flex',
                gap: '14px',
                alignItems: 'center',
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '12px 16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '68px',
                  height: '68px',
                  borderRadius: '50%',
                  border: `3px solid ${scoreColor}`,
                  color: scoreColor,
                  fontWeight: 800,
                  fontSize: '20px',
                  flexShrink: 0,
                }}
              >
                {report.score}
                <span style={{ fontSize: '9px', fontWeight: 500, color: 'var(--muted)' }}>SCORE</span>
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
                  {report.summary}
                </div>
                {report.strengths.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {report.strengths.map((st, i) => (
                      <span key={i} className="badge" style={{ borderColor: 'var(--accent2)', color: 'var(--text)' }}>
                        ✓ {st}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Issues Action Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['all', 'critical', 'warning', 'suggestion'] as const).map((cat) => (
                  <button
                    key={cat}
                    className={`btn xs ${filter === cat ? 'primary' : 'ghost'}`}
                    onClick={() => setFilter(cat)}
                  >
                    {cat.toUpperCase()} ({cat === 'all' ? issues.length : issues.filter((i) => i.severity === cat).length})
                  </button>
                ))}
              </div>

              {unappliedCount > 0 && (
                <button className="btn primary xs" onClick={handleFixAll}>
                  ⚡ Fix All ({unappliedCount}) Automatically
                </button>
              )}
            </div>

            {/* Issues List */}
            {filteredIssues.length === 0 ? (
              <div className="muted small" style={{ textAlign: 'center', padding: '24px 0' }}>
                No issues found under this filter. Great job!
              </div>
            ) : (
              filteredIssues.map((iss) => {
                const sevColor =
                  iss.severity === 'critical'
                    ? 'var(--danger)'
                    : iss.severity === 'warning'
                      ? '#f59e0b'
                      : 'var(--accent2)';

                return (
                  <div
                    key={iss.id}
                    style={{
                      background: 'var(--panel2)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      opacity: iss.applied ? 0.6 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            color: '#fff',
                            background: sevColor,
                            textTransform: 'uppercase',
                          }}
                        >
                          {iss.severity}
                        </span>
                        <strong style={{ fontSize: '13px' }}>{iss.title}</strong>
                        <span className="muted small">Lines {iss.startLine}–{iss.endLine}</span>
                      </div>

                      {iss.applied ? (
                        <span className="small muted">✓ Applied</span>
                      ) : (
                        <button className="btn xs primary" onClick={() => handleFixSingle(iss)}>
                          Apply Fix
                        </button>
                      )}
                    </div>

                    <div className="muted small">{iss.description}</div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                      <div style={{ background: 'var(--panel)', padding: '6px 8px', borderRadius: '6px', fontSize: '11.5px', border: '1px solid var(--border)' }}>
                        <div className="muted small" style={{ marginBottom: '2px', color: 'var(--danger)' }}>Current:</div>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                          {iss.originalText || '(see lines in editor)'}
                        </pre>
                      </div>
                      <div style={{ background: 'var(--panel)', padding: '6px 8px', borderRadius: '6px', fontSize: '11.5px', border: '1px solid var(--accent2)' }}>
                        <div className="muted small" style={{ marginBottom: '2px', color: 'var(--accent2)' }}>Proposed Improvement:</div>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                          {iss.proposedText}
                        </pre>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {!report && !running && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              padding: '40px 20px',
              textAlign: 'center',
            }}
          >
            <span style={{ color: 'var(--accent)' }}>
              <Icon name="sparkles" size={32} />
            </span>
            <h3 style={{ margin: 0 }}>Ready to Audit Your Document</h3>
            <p className="muted small" style={{ maxWidth: '460px', margin: 0 }}>
              The Autonomous Review Agent scans your document for LaTeX math errors, ATS keyword strength,
              action verbs, citation completeness, and sentence structure, proposing surgical 1-click fixes.
            </p>
          </div>
        )}

        <div className="row end" style={{ marginTop: '12px' }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
