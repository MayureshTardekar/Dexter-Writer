import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import { latexToReadable, typstToReadable } from "../lib/docUtils";
import { rehypeSourceLine } from "../lib/rehypeSourceLine";
import { renderTypstSvg, warmupTypstEngine } from "../lib/typstEngine";
import { compileLatexPdf, isLatexEngineReady, isRemoteCompilerConfigured, subscribeLatexStatus } from "../lib/latexEngine";
import { fixLatexError } from "../lib/latexFixer";
import { toast } from "../lib/toast";
import type { DocMode } from "../lib/templates";
import MermaidBlock from "./MermaidBlock";

export interface SourceJump {
  line?: number;
  text: string;
}

const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2.0];

function handlePreviewDblClick(e: RMouseEvent, allowLine: boolean, onSourceJump?: (info: SourceJump) => void): void {
  if (!onSourceJump) return;
  const t = e.target as HTMLElement;
  const lined = t.closest?.("[data-source-line]") as HTMLElement | null;
  if (allowLine && lined?.dataset.sourceLine) {
    onSourceJump({ line: Number(lined.dataset.sourceLine), text: (lined.textContent || "").slice(0, 120) });
    return;
  }
  const block = t.closest?.("h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote,pre") as HTMLElement | null;
  const text = ((block?.textContent || t.textContent) || "").trim();
  if (text) onSourceJump({ text: text.slice(0, 120) });
}

// Unified Overleaf-Style Preview Toolbar (Single 32px slim bar)
interface UnifiedToolbarProps {
  mode: DocMode;
  zoom: number;
  onZoom: (z: number) => void;
  onCompilePdf?: () => void;
  compiling?: boolean;
  statusText?: string;
  pdfUrl?: string | null;
  pageCount?: number | null;
  warningsCount?: number;
  showLog?: boolean;
  onToggleLog?: () => void;
  onToggleMax?: () => void;
  maximized?: boolean;
  onHide?: () => void;
  pdfMode?: boolean;
  onTogglePdf?: () => void;
}

function UnifiedToolbar({
  mode: _mode,
  zoom,
  onZoom,
  onCompilePdf,
  compiling,
  statusText,
  pdfUrl,
  pageCount,
  warningsCount = 0,
  showLog,
  onToggleLog,
  onToggleMax,
  maximized,
  onHide,
  pdfMode,
  onTogglePdf,
}: UnifiedToolbarProps) {
  function stepZoom(dir: 1 | -1) {
    const cur = ZOOM_STEPS.indexOf(zoom);
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, cur + dir))];
    if (next !== undefined) onZoom(next);
  }

  return (
    <div
      className="preview-toolbar"
      style={{
        height: "32px",
        minHeight: "32px",
        padding: "0 8px",
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "var(--panel)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}
    >
      {/* 1. Primary Recompile Button (Overleaf style) */}
      <button
        className={`btn xs btn-recompile ${compiling ? "compiling" : ""}`}
        onClick={onCompilePdf}
        disabled={compiling}
        title="Recompile document (Ctrl+Enter)"
        style={{ height: "24px", padding: "0 10px", fontSize: "11px" }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span>{compiling ? "Compiling…" : "Recompile"}</span>
      </button>

      {/* 2. Silent Status Indicator */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "11px", color: "var(--muted)", marginLeft: 2 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: compiling ? "#60a5fa" : "#10b981",
            display: "inline-block",
          }}
        />
        <span>{compiling ? "Compiling…" : (statusText || "Ready")}</span>
      </span>

      {warningsCount > 0 && !compiling && onToggleLog && (
        <button
          className="btn xs ghost"
          style={{ fontSize: 10, padding: "1px 5px", color: "#fbbf24", height: "20px" }}
          title={`${warningsCount} TeX warning(s)`}
          onClick={onToggleLog}
        >
          ⚠ {warningsCount}
        </button>
      )}

      <span className="tb-sep" style={{ margin: "0 4px", height: "14px" }} />

      {/* 3. Zoom Controls */}
      <button className="btn xs ghost icon-btn" onClick={() => stepZoom(-1)} title="Zoom out" aria-label="Zoom out" style={{ width: 22, height: 22 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>
      <span className="preview-zoom-label" style={{ fontSize: "11px", minWidth: 32 }}>{Math.round(zoom * 100)}%</span>
      <button className="btn xs ghost icon-btn" onClick={() => stepZoom(1)} title="Zoom in" aria-label="Zoom in" style={{ width: 22, height: 22 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>
      <button className="btn xs ghost" onClick={() => onZoom(1.0)} title="Reset zoom (Fit Width)" aria-label="Reset zoom" style={{ padding: "0 5px", fontSize: 10, height: "20px" }}>
        1:1
      </button>
      <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--muted)", marginLeft: 2 }}>
        {pageCount ? `1 / ${pageCount}` : "1 / 1"}
      </span>

      <div style={{ flex: 1 }} />

      {/* 4. Action buttons: Download PDF, Log, Rich toggle, Maximize, Collapse */}
      {pdfUrl && (
        <a
          href={pdfUrl}
          download="resume.pdf"
          className="btn xs ghost icon-btn"
          style={{ height: "22px", padding: "0 6px", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}
          title="Download PDF"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span className="hide-sm">PDF</span>
        </a>
      )}

      {onToggleLog && (
        <button
          className="btn xs ghost"
          style={{ fontSize: 10, padding: "0 6px", height: "20px" }}
          onClick={onToggleLog}
          title="Toggle TeX Log"
        >
          {showLog ? "Hide Log" : "Log"}
        </button>
      )}

      {onTogglePdf && (
        <button
          className={`btn xs ${pdfMode ? "ghost" : "primary"}`}
          onClick={onTogglePdf}
          title={pdfMode ? "Switch to rich preview" : "Show compiled PDF"}
          style={{ height: "20px", fontSize: 10, padding: "0 5px" }}
        >
          {pdfMode ? "Rich" : "PDF"}
        </button>
      )}

      {onToggleMax && (
        <button className="btn xs ghost icon-btn" onClick={onToggleMax} title={maximized ? "Restore split view" : "Maximize preview"} style={{ width: 22, height: 22 }}>
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          )}
        </button>
      )}

      {onHide && (
        <button className="btn xs ghost icon-btn" onClick={onHide} title="Hide preview" style={{ width: 22, height: 22 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="13 17 18 12 13 7" />
            <polyline points="6 17 11 12 6 7" />
          </svg>
        </button>
      )}
    </div>
  );
}

// Markdown / LaTeX rich preview
function MarkdownPreview({
  content,
  theme = "dark",
  sourceMap = true,
  allowHtml = false,
  onSourceJump,
  zoom = 1.0,
  onZoom,
  compact = false,
  onToggleMax,
  maximized,
  onHide,
  pdfMode,
  onTogglePdf,
}: {
  content: string;
  theme?: "dark" | "light";
  sourceMap?: boolean;
  allowHtml?: boolean;
  onSourceJump?: (info: SourceJump) => void;
  zoom?: number;
  onZoom?: (z: number) => void;
  compact?: boolean;
  onToggleMax?: () => void;
  maximized?: boolean;
  onHide?: () => void;
  pdfMode?: boolean;
  onTogglePdf?: () => void;
}) {
  const rehypePlugins = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugins: any[] = [rehypeKatex];
    if (allowHtml) plugins.unshift(rehypeRaw);
    if (sourceMap) plugins.push(rehypeSourceLine);
    return plugins;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMap, allowHtml]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {onZoom && (
        <UnifiedToolbar
          mode={onTogglePdf ? "latex" : "markdown"}
          zoom={zoom}
          onZoom={onZoom}
          onCompilePdf={onTogglePdf}
          onToggleMax={onToggleMax}
          maximized={maximized}
          onHide={onHide}
          pdfMode={pdfMode}
          onTogglePdf={onTogglePdf}
        />
      )}
      {!content.trim() ? (
        <div className="preview-scroll" style={{ flex: 1, overflow: "auto" }}>
          <div className="preview-empty">
            <p><strong>Empty document</strong></p>
            <p>Start typing in the editor — the preview renders here instantly.</p>
          </div>
        </div>
      ) : (
        <div
          className="preview-scroll"
          style={{ flex: 1, overflow: "auto" }}
          onDoubleClick={(e) => handlePreviewDblClick(e, sourceMap, onSourceJump)}
          title="Double-click to jump to source"
        >
          <div className="preview-zoom-wrap" style={{ transform: `scale(${zoom})` }}>
            <article className={`preview-doc${compact ? " resume-doc" : ""}`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={rehypePlugins}
                components={{
                  code(props) {
                    const { children, className, ...rest } = props;
                    const match = /language-(\w+)/.exec(className || "");
                    if (match && match[1] === "mermaid") {
                      return <MermaidBlock chart={String(children).replace(/\n$/, "")} theme={theme} />;
                    }
                    return <code {...rest} className={className}>{children}</code>;
                  },
                }}
              >
                {content}
              </ReactMarkdown>
            </article>
          </div>
        </div>
      )}
    </div>
  );
}

// Typst preview
function TypstPreview({
  content,
  onSourceJump,
  zoom = 1.0,
  onZoom,
  onToggleMax,
  maximized,
  onHide,
}: {
  content: string;
  onSourceJump?: (info: SourceJump) => void;
  zoom?: number;
  onZoom?: (z: number) => void;
  onToggleMax?: () => void;
  maximized?: boolean;
  onHide?: () => void;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const seq = useRef(0);

  useEffect(() => { warmupTypstEngine(); }, []);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    setCompiling(true);
    const my = ++seq.current;
    timer.current = window.setTimeout(async () => {
      try {
        const res = await renderTypstSvg(content);
        if (seq.current !== my) return;
        setSvg(res.svg ?? null);
        setDiagnostics(res.diagnostics);
        setError(res.error ?? null);
        setMs(res.compileMs ?? null);
      } catch (e) {
        if (seq.current !== my) return;
        setError(e instanceof Error ? e.message : String(e));
        setSvg(null);
      } finally {
        if (seq.current === my) setCompiling(false);
      }
    }, 700);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [content]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {onZoom && (
        <UnifiedToolbar
          mode="typst"
          zoom={zoom}
          onZoom={onZoom}
          compiling={compiling}
          statusText={compiling ? "Compiling…" : ms != null ? `Typst · ${ms}ms` : "Ready"}
          warningsCount={diagnostics.length}
          onToggleMax={onToggleMax}
          maximized={maximized}
          onHide={onHide}
        />
      )}
      {diagnostics.length > 0 && <pre className="typst-diag-list" style={{ margin: 0 }}>{diagnostics.slice(0, 8).join("\n")}</pre>}
      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(239, 68, 68, 0.15)", color: "#f87171", fontSize: "11px", fontFamily: "var(--mono)" }}>
          ⚠️ {error}
        </div>
      )}
      {svg ? (
        <div className="preview-scroll typst" style={{ flex: 1, overflow: "auto" }}>
          <div className="preview-zoom-wrap" style={{ transform: `scale(${zoom})` }}>
            {/* eslint-disable-next-line react/no-danger */}
            <div className="typst-svg" dangerouslySetInnerHTML={{ __html: svg }} onDoubleClick={(e) => handlePreviewDblClick(e, false, onSourceJump)} title="Double-click to jump to source" />
          </div>
        </div>
      ) : (
        <div className="preview-scroll" style={{ flex: 1, overflow: "auto" }} onDoubleClick={(e) => handlePreviewDblClick(e, false, onSourceJump)} title="Double-click to jump to source">
          <div className="preview-zoom-wrap" style={{ transform: `scale(${zoom})` }}>
            <article className="preview-doc">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{typstToReadable(content)}</ReactMarkdown>
            </article>
          </div>
        </div>
      )}
    </div>
  );
}

// LaTeX WASM / Cloud preview (Overleaf-Exact)
function LatexPreview({
  content,
  zoom = 1.0,
  onZoom,
  onPdfReady,
  compileTrigger,
  onCompilingChange,
  onRecompile,
  onToggleMax,
  maximized,
  onHide,
  pdfMode,
  onTogglePdf,
  onFixProposal,
  provider,
  apiKey,
  model,
  baseUrl,
  onOpenByok,
}: {
  content: string;
  zoom?: number;
  onZoom: (z: number) => void;
  onPdfReady?: (ready: boolean, url: string | null) => void;
  compileTrigger?: number;
  onCompilingChange?: (compiling: boolean) => void;
  onRecompile?: () => void;
  onToggleMax?: () => void;
  maximized?: boolean;
  onHide?: () => void;
  pdfMode?: boolean;
  onTogglePdf?: () => void;
  onFixProposal?: (proposal: { summary: string; before: string; after: string }) => void;
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  onOpenByok?: () => void;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [fullLog, setFullLog] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [pdfMeta, setPdfMeta] = useState<{ pages: number | null; warnings: string[] } | null>(null);
  const [needsEngine, setNeedsEngine] = useState(false);
  const [fixing, setFixing] = useState(false);
  const timer = useRef<number | null>(null);
  const seq = useRef(0);

  const handleFixWithAi = useCallback(async () => {
    if (!content.trim() || !error || fixing) return;
    setFixing(true);
    toast("Analyzing compilation error with AI…", "info", 2500);

    try {
      const res = await fixLatexError({
        content,
        error,
        fullLog,
        provider,
        apiKey,
        model,
        baseUrl,
      });

      if (!res.success) {
        if (res.needsKey) {
          toast(res.error || "Please set up your AI key in settings (BYOK)", "error", 3500);
          onOpenByok?.();
        } else {
          toast(res.error || "AI could not fix this error", "error", 3500);
        }
        return;
      }

      if (res.fixedCode) {
        onFixProposal?.({
          summary: `Fix LaTeX Error: ${error.slice(0, 50)}`,
          before: content,
          after: res.fixedCode,
        });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Fix request failed", "error", 3500);
    } finally {
      setFixing(false);
    }
  }, [content, error, fixing, fullLog, provider, apiKey, model, baseUrl, onOpenByok, onFixProposal]);

  useEffect(() => {
    return subscribeLatexStatus((_status, _progress, msg) => {
      if (msg) setStatusMsg(msg);
    });
  }, []);

  const doCompile = useCallback(async (src: string) => {
    if (!src.trim()) return;
    setCompiling(true);
    setNeedsEngine(false);
    setPdfMeta(null);
    onCompilingChange?.(true);
    const my = ++seq.current;
    try {
      const res = await compileLatexPdf(src);
      if (seq.current !== my) return;
      if (res.success && res.pdfUrl) {
        setPdfUrl(res.pdfUrl);
        setError(null);
        setFullLog(res.log || null);
        setPdfMeta({ pages: res.pages ?? null, warnings: res.warnings ?? [] });
        onPdfReady?.(true, res.pdfUrl);
      } else {
        setError(res.error || "Compilation failed. Check log for details.");
        setFullLog(res.log || null);
        setPdfMeta({ pages: res.pages ?? null, warnings: res.warnings ?? [] });
        onPdfReady?.(false, null);
      }
    } catch (e) {
      if (seq.current !== my) return;
      setError(e instanceof Error ? e.message : String(e));
      onPdfReady?.(false, null);
    } finally {
      if (seq.current === my) {
        setCompiling(false);
        onCompilingChange?.(false);
      }
    }
  }, [onPdfReady, onCompilingChange]);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!isLatexEngineReady() && !isRemoteCompilerConfigured()) {
      setNeedsEngine(true);
      return;
    }
    setNeedsEngine(false);
    timer.current = window.setTimeout(() => {
      void doCompile(content);
    }, 1200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [content, doCompile]);

  useEffect(() => {
    if (compileTrigger && compileTrigger > 0) {
      if (timer.current) window.clearTimeout(timer.current);
      void doCompile(content);
    }
  }, [compileTrigger, content, doCompile]);

  return (
    <div className="preview-scroll latex-preview" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", padding: 0 }}>
      {/* 1. Unified Overleaf 32px Toolbar */}
      <UnifiedToolbar
        mode="latex"
        zoom={zoom}
        onZoom={onZoom}
        onCompilePdf={onRecompile || (() => void doCompile(content))}
        compiling={compiling}
        statusText={compiling ? "Compiling…" : pdfMeta?.pages != null ? `Ready · ${pdfMeta.pages} page${pdfMeta.pages === 1 ? "" : "s"}` : statusMsg || "Ready"}
        pdfUrl={pdfUrl}
        pageCount={pdfMeta?.pages}
        warningsCount={pdfMeta?.warnings.length || 0}
        showLog={showLog}
        onToggleLog={fullLog ? () => setShowLog(!showLog) : undefined}
        onToggleMax={onToggleMax}
        maximized={maximized}
        onHide={onHide}
        pdfMode={pdfMode}
        onTogglePdf={onTogglePdf}
      />

      {/* 2. Optional TeX Log Dropdown */}
      {showLog && fullLog && (
        <pre className="typst-diag-list" style={{ maxHeight: 180, overflow: "auto", background: "var(--surface-sunken)", color: "var(--text-secondary)", margin: 0, padding: 8, fontSize: 11 }}>
          {fullLog}
        </pre>
      )}

      {/* 3. Error message with Fix with AI */}
      {error && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(239, 68, 68, 0.15)",
            borderBottom: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#f87171",
            fontSize: "11px",
            fontFamily: "var(--mono)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            zIndex: 5,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            ⚠️ {error}
          </span>
          {onFixProposal && (
            <button
              className="btn xs primary"
              onClick={() => void handleFixWithAi()}
              disabled={fixing}
              style={{
                fontSize: 10,
                padding: "2px 8px",
                height: "22px",
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "linear-gradient(135deg, #2563eb, #7c3aed)",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: fixing ? "wait" : "pointer",
              }}
              title="Analyze compiler log and generate fix with AI"
            >
              {fixing ? (
                <>
                  <span style={{ display: "inline-block" }}>⏳</span>
                  <span>Fixing…</span>
                </>
              ) : (
                <>
                  <span>🪄</span>
                  <span>Fix with AI</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* 4. Full-Bleed PDF Preview Iframe (Overleaf Fit-Width) */}
      {pdfUrl ? (
        <div style={{ flex: 1, width: "100%", height: "100%", overflow: "hidden", position: "relative", background: "#323639" }}>
          <iframe
            key={`${pdfUrl}-${zoom}`}
            src={`${pdfUrl}#view=FitH&zoom=${zoom === 1.0 ? "page-width" : Math.round(zoom * 100)}&toolbar=0&navpanes=0`}
            title="LaTeX PDF Preview"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              border: "none",
              display: "block",
              margin: 0,
              padding: 0,
              background: "#323639",
            }}
          />
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto" }}>
          {needsEngine && !compiling && (
            <div className="engine-gate">
              <h3>Real PDF preview</h3>
              <p>
                Compiles with Overleaf-grade LaTeX compiler. Extra packages fetch on demand.
              </p>
              <button className="btn primary" onClick={() => void doCompile(content)}>
                Load engine &amp; compile
              </button>
            </div>
          )}
          <div className="preview-zoom-wrap" style={{ transform: `scale(${zoom})`, opacity: 0.7, padding: "16px" }}>
            <article className="preview-doc resume-doc">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{latexToReadable(content)}</ReactMarkdown>
            </article>
          </div>
        </div>
      )}
    </div>
  );
}

// Root export
export default function PreviewPane({
  content,
  mode,
  theme,
  onSourceJump,
  compileTrigger,
  onToggleMax,
  maximized,
  onHide,
  onFixProposal,
  provider,
  apiKey,
  model,
  baseUrl,
  onOpenByok,
}: {
  content: string;
  mode: DocMode;
  theme?: "dark" | "light";
  onSourceJump?: (info: SourceJump) => void;
  compileTrigger?: number;
  onToggleMax?: () => void;
  maximized?: boolean;
  onHide?: () => void;
  onFixProposal?: (proposal: { summary: string; before: string; after: string }) => void;
  provider?: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  onOpenByok?: () => void;
}) {
  const [zoom, setZoom] = useState(1.0);
  const [pdfMode, setPdfMode] = useState(true);
  const [, setPdfReady] = useState(false);
  const [, setCompilingLatex] = useState(false);
  const [manualRecompile, setManualRecompile] = useState(0);

  const isLatex = mode === "latex" || content.trim().startsWith('\\documentclass') || content.includes('\\begin{document}');

  const handleRecompile = useCallback(() => {
    setManualRecompile((t) => t + 1);
  }, []);

  const md = useMemo(() => {
    if (mode === "latex") return latexToReadable(content);
    if (mode === "typst") return typstToReadable(content);
    return content;
  }, [content, mode]);

  if (mode === "typst") {
    return (
      <TypstPreview
        content={content}
        onSourceJump={onSourceJump}
        zoom={zoom}
        onZoom={setZoom}
        onToggleMax={onToggleMax}
        maximized={maximized}
        onHide={onHide}
      />
    );
  }

  if (isLatex && pdfMode) {
    return (
      <LatexPreview
        content={content}
        zoom={zoom}
        onZoom={setZoom}
        onPdfReady={(ready) => setPdfReady(ready)}
        onCompilingChange={setCompilingLatex}
        compileTrigger={(compileTrigger || 0) + manualRecompile}
        onRecompile={handleRecompile}
        onToggleMax={onToggleMax}
        maximized={maximized}
        onHide={onHide}
        pdfMode={pdfMode}
        onTogglePdf={() => setPdfMode(false)}
        onFixProposal={onFixProposal}
        provider={provider}
        apiKey={apiKey}
        model={model}
        baseUrl={baseUrl}
        onOpenByok={onOpenByok}
      />
    );
  }

  const exact = mode === "markdown";
  const isResume = mode === "latex" && /\\(resumeItem|resumeSubheading|resumeProjectHeading|begin\{itemize\})/.test(content);
  return (
    <MarkdownPreview
      content={md}
      theme={theme}
      sourceMap={exact}
      allowHtml={isLatex}
      onSourceJump={onSourceJump}
      zoom={zoom}
      onZoom={setZoom}
      compact={isResume}
      onToggleMax={onToggleMax}
      maximized={maximized}
      onHide={onHide}
      pdfMode={isLatex ? pdfMode : undefined}
      onTogglePdf={isLatex ? () => setPdfMode(true) : undefined}
    />
  );
}
