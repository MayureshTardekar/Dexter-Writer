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

// Zoom toolbar
interface ZoomBarProps {
  zoom: number;
  onZoom: (z: number) => void;
  mode: DocMode;
  onCompilePdf?: () => void;
  compilingPdf?: boolean;
  pdfReady?: boolean;
  pdfMode?: boolean;
  onTogglePdf?: () => void;
}

function ZoomBar({ zoom, onZoom, mode, onCompilePdf, compilingPdf, pdfReady, pdfMode, onTogglePdf }: ZoomBarProps) {
  function stepZoom(dir: 1 | -1) {
    const cur = ZOOM_STEPS.indexOf(zoom);
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, cur + dir))];
    if (next !== undefined) onZoom(next);
  }

  return (
    <div className="preview-toolbar">
      <button
        className={`btn xs btn-recompile ${compilingPdf ? 'compiling' : ''}`}
        onClick={() => {
          if (onCompilePdf) onCompilePdf();
        }}
        disabled={compilingPdf}
        title="Recompile document (Ctrl+Enter)"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <span>{compilingPdf ? 'Compiling…' : 'Recompile'}</span>
      </button>
      <span className="tb-sep" style={{ margin: "0 6px", height: "16px" }} />
      <button className="btn xs ghost icon-btn" onClick={() => stepZoom(-1)} title="Zoom out" aria-label="Zoom out">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </button>
      <span className="preview-zoom-label">{Math.round(zoom * 100)}%</span>
      <button className="btn xs ghost icon-btn" onClick={() => stepZoom(1)} title="Zoom in" aria-label="Zoom in">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </button>
      <button className="btn xs ghost" onClick={() => onZoom(1.0)} title="Reset zoom" aria-label="Reset zoom" style={{ padding: "0 6px", fontSize: 10 }}>
        1:1
      </button>
      <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--muted)", marginLeft: 6 }}>1 / 1</span>
      {mode === "latex" && (
        <span className="preview-compile-btn" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {pdfReady && (
            <button className={`btn xs ${pdfMode ? "primary" : "ghost"}`} onClick={onTogglePdf} title={pdfMode ? "Switch to rich preview" : "Show compiled PDF"}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              {pdfMode ? " Rich Preview" : " PDF View"}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

// Markdown / LaTeX rich preview
function MarkdownPreview({ content, theme = "dark", sourceMap = true, allowHtml = false, articleRef, onSourceJump, zoom = 1.0, compact = false }: {
  content: string; theme?: "dark" | "light"; sourceMap?: boolean; allowHtml?: boolean;
  articleRef?: React.RefCallback<HTMLElement>;
  onSourceJump?: (info: SourceJump) => void; zoom?: number; compact?: boolean;
}) {
  const rehypePlugins = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plugins: any[] = [rehypeKatex];
    if (allowHtml) plugins.unshift(rehypeRaw);
    if (sourceMap) plugins.push(rehypeSourceLine);
    return plugins;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMap, allowHtml]);
  if (!content.trim()) {
    return (
      <div className="preview-scroll">
        <div className="preview-empty">
          <p><strong>Empty document</strong></p>
          <p>Start typing in the editor — the preview renders here instantly.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="preview-scroll" onDoubleClick={(e) => handlePreviewDblClick(e, sourceMap, onSourceJump)} title="Double-click to jump to source">
      <div className="preview-zoom-wrap" style={{ transform: `scale(${zoom})` }}>
        <article className={`preview-doc${compact ? " resume-doc" : ""}`} ref={articleRef}>
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
  );
}

// Typst preview
function TypstPreview({ content, onSourceJump, zoom = 1.0 }: { content: string; onSourceJump?: (info: SourceJump) => void; zoom?: number; }) {
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

  if (svg) {
    return (
      <div className="preview-scroll typst">
        <div className="typst-status muted small">
          {compiling ? "Recompiling..." : `Typst WASM${ms != null ? ` · ${ms}ms` : ""}`}
          {diagnostics.length > 0 && <span className="typst-diag"> · {diagnostics.length} diagnostic{diagnostics.length === 1 ? "" : "s"}</span>}
        </div>
        {diagnostics.length > 0 && <pre className="typst-diag-list">{diagnostics.slice(0, 8).join("\n")}</pre>}
        <div className="preview-zoom-wrap" style={{ transform: `scale(${zoom})` }}>
          {/* eslint-disable-next-line react/no-danger */}
          <div className="typst-svg" dangerouslySetInnerHTML={{ __html: svg }} onDoubleClick={(e) => handlePreviewDblClick(e, false, onSourceJump)} title="Double-click to jump to source" />
        </div>
      </div>
    );
  }

  return (
    <div className="preview-scroll" onDoubleClick={(e) => handlePreviewDblClick(e, false, onSourceJump)} title="Double-click to jump to source">
      <div className="typst-status muted small">{compiling ? "Loading Typst engine..." : error ? `Error: ${error}` : ""}</div>
      {diagnostics.length > 0 && <pre className="typst-diag-list">{diagnostics.slice(0, 8).join("\n")}</pre>}
      <div className="preview-zoom-wrap" style={{ transform: `scale(${zoom})` }}>
        <article className="preview-doc">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{typstToReadable(content)}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
}

// LaTeX WASM preview (Overleaf-Exact)
function LatexPreview({
  content,
  zoom = 1.0,
  onPdfReady,
  compileTrigger,
  onCompilingChange
}: {
  content: string;
  zoom?: number;
  onPdfReady?: (ready: boolean, url: string | null) => void;
  compileTrigger?: number;
  onCompilingChange?: (compiling: boolean) => void;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [fullLog, setFullLog] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [compileMs, setCompileMs] = useState<number | null>(null);
  const [pdfMeta, setPdfMeta] = useState<{ pages: number | null; warnings: string[] } | null>(null);
  const [needsEngine, setNeedsEngine] = useState(false);
  const timer = useRef<number | null>(null);
  const seq = useRef(0);

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
        setCompileMs(res.compileMs || null);
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

  // Debounced compilation on typing — but only once the engine is loaded
  // or when an AWS Lambda cloud compiler is configured (0 MB download).
  // The Recompile button / Ctrl+Enter always loads it on demand.
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

  // Immediate compilation on compileTrigger (e.g. Recompile button / Ctrl+Enter)
  useEffect(() => {
    if (compileTrigger && compileTrigger > 0) {
      if (timer.current) window.clearTimeout(timer.current);
      void doCompile(content);
    }
  }, [compileTrigger, content, doCompile]);

  if (pdfUrl) {
    return (
      <div className="preview-scroll latex-preview" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        <div className="typst-status muted small" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 14px", background: "var(--surface-sunken)", borderBottom: "1px solid var(--border)" }}>
          <span>
            {compiling
              ? (statusMsg || (isRemoteCompilerConfigured() ? "Compiling with AWS Lambda…" : "Compiling pdfLaTeX WASM…"))
              : `${isRemoteCompilerConfigured() ? "LaTeX Cloud Engine (AWS Lambda)" : "pdfLaTeX WASM (Overleaf Engine)"}${compileMs != null ? ` · ${compileMs}ms` : ""}${pdfMeta?.pages != null ? ` · ${pdfMeta.pages} page${pdfMeta.pages === 1 ? "" : "s"}` : ""}`}
            {pdfMeta && pdfMeta.warnings.length > 0 && !compiling && (
              <button
                className="btn xs ghost"
                style={{ fontSize: 10, padding: "2px 6px", marginLeft: 6, color: "#fbbf24" }}
                title={pdfMeta.warnings.join("\n")}
                onClick={() => setShowLog(true)}
              >
                ⚠ {pdfMeta.warnings.length}
              </button>
            )}
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <a
              href={pdfUrl}
              download="resume.pdf"
              className="btn xs ghost"
              style={{ fontSize: 10, padding: "2px 8px", textDecoration: "none" }}
              title="Download compiled PDF"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download PDF
            </a>
            {fullLog && (
              <button
                className="btn xs ghost"
                style={{ fontSize: 10, padding: "2px 6px" }}
                onClick={() => setShowLog(!showLog)}
              >
                {showLog ? "Hide Log" : "TeX Log"}
              </button>
            )}
          </div>
        </div>
        {showLog && fullLog && (
          <pre className="typst-diag-list" style={{ maxHeight: 180, overflow: "auto", background: "var(--surface-sunken)", color: "var(--text-secondary)", margin: 0, padding: 8, fontSize: 11 }}>
            {fullLog}
          </pre>
        )}
        {error && (
          <div style={{ padding: "8px 12px", background: "rgba(239, 68, 68, 0.15)", borderBottom: "1px solid rgba(239, 68, 68, 0.3)", color: "#f87171", fontSize: "11px", fontFamily: "var(--mono)" }}>
            ⚠️ {error}
          </div>
        )}
        <div className="preview-zoom-wrap" style={{ transform: `scale(${zoom})`, transformOrigin: "top center", width: "100%", flex: 1, height: "100%", overflow: "auto", padding: "16px" }}>
          <iframe
            src={`${pdfUrl}#toolbar=0&navpanes=0&view=FitH`}
            title="LaTeX PDF Preview"
            style={{
              width: "100%",
              minHeight: "1150px",
              height: "100%",
              border: "none",
              background: "#fff",
              borderRadius: "6px",
              boxShadow: "0 4px 24px rgba(0,0,0,0.18)"
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="preview-scroll" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {needsEngine && !compiling && (
        <div className="engine-gate">
          <h3>Real PDF preview</h3>
          <p>
            Compiles with pdfLaTeX (Overleaf-grade output). One-time download of about
            <strong> 120 MB</strong>, cached offline afterwards. Extra packages fetch
            on demand only if your document needs them.
          </p>
          <button className="btn primary" onClick={() => void doCompile(content)}>
            Load engine &amp; compile
          </button>
        </div>
      )}
      <div className="typst-status muted small" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "var(--surface-sunken)" }}>
        <div className="spinner" style={{ width: 12, height: 12, border: "2px solid var(--border)", borderTopColor: "var(--primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <span>{statusMsg || "Press Recompile for real PDF output."}</span>
      </div>
      {error && (
        <div style={{ padding: "8px 12px", background: "rgba(239, 68, 68, 0.15)", color: "#f87171", fontSize: "11px", fontFamily: "var(--mono)" }}>
          ⚠️ {error}
        </div>
      )}
      <div className="preview-zoom-wrap" style={{ transform: `scale(${zoom})`, opacity: 0.7, padding: "16px" }}>
        <article className="preview-doc resume-doc">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{latexToReadable(content)}</ReactMarkdown>
        </article>
      </div>
    </div>
  );
}

// Fallback HTML print preview
function printPreviewAsPdf(previewDocEl: HTMLElement | null): void {
  if (!previewDocEl) {
    alert("Preview is empty — type some LaTeX first.");
    return;
  }

  const styleLinks: string[] = [];
  const inlineStyles: string[] = [];
  document.querySelectorAll("link[rel=\"stylesheet\"]").forEach((el) => {
    const href = (el as HTMLLinkElement).href;
    if (href) styleLinks.push(`<link rel="stylesheet" href="${href}">`);
  });
  document.querySelectorAll("style").forEach((el) => {
    inlineStyles.push(`<style>${el.textContent}</style>`);
  });

  const clone = previewDocEl.cloneNode(true) as HTMLElement;

  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) {
    alert("Pop-up blocked — please allow pop-ups for this site to export PDF.");
    return;
  }

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Resume — Export PDF</title>
  ${styleLinks.join("\n")}
  ${inlineStyles.join("\n")}
  <style>
    @page { size: A4; margin: 0; }
    html, body {
      margin: 0; padding: 0;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body { background: #fff !important; }
    .preview-doc {
      box-shadow: none !important;
      border-radius: 0 !important;
      margin: 0 auto !important;
      padding: 28px 48px 36px !important;
      max-width: 780px !important;
      min-height: 100vh;
      background: #fff !important;
    }
  </style>
</head>
<body>
  ${clone.outerHTML}
  <script>
    window.onload = function() { setTimeout(function() { window.print(); }, 400); };
  </script>
</body>
</html>`);
  printWindow.document.close();
}

// Root export
export default function PreviewPane({ content, mode, theme, onSourceJump, compileTrigger }: {
  content: string; mode: DocMode; theme?: "dark" | "light"; onSourceJump?: (info: SourceJump) => void; compileTrigger?: number;
}) {
  const [zoom, setZoom] = useState(1.0);
  const [pdfMode, setPdfMode] = useState(true);
  const [pdfReady, setPdfReady] = useState(false);
  const [compilingLatex, setCompilingLatex] = useState(false);
  const [manualRecompile, setManualRecompile] = useState(0);

  // Ref to the rendered <article class="preview-doc"> element for print fallback
  const previewDocRef = useRef<HTMLElement | null>(null);

  const isLatex = mode === "latex";

  const handleRecompile = useCallback(() => {
    if (isLatex) {
      setManualRecompile((t) => t + 1);
    } else {
      printPreviewAsPdf(previewDocRef.current);
    }
  }, [isLatex]);

  const md = useMemo(() => {
    if (mode === "latex") return latexToReadable(content);
    if (mode === "typst") return typstToReadable(content);
    return content;
  }, [content, mode]);

  const zoomBar = (
    <ZoomBar
      zoom={zoom}
      onZoom={setZoom}
      mode={mode}
      onCompilePdf={handleRecompile}
      compilingPdf={isLatex ? compilingLatex : false}
      pdfReady={isLatex ? pdfReady : false}
      pdfMode={pdfMode}
      onTogglePdf={isLatex ? () => setPdfMode((p) => !p) : undefined}
    />
  );

  if (mode === "typst") {
    return (<>{zoomBar}<TypstPreview content={content} onSourceJump={onSourceJump} zoom={zoom} /></>);
  }

  if (isLatex && pdfMode) {
    return (
      <>
        {zoomBar}
        <LatexPreview
          content={content}
          zoom={zoom}
          onPdfReady={(ready) => setPdfReady(ready)}
          onCompilingChange={setCompilingLatex}
          compileTrigger={(compileTrigger || 0) + manualRecompile}
        />
      </>
    );
  }

  const exact = mode === "markdown";
  const isResume = mode === "latex" && /\\(resumeItem|resumeSubheading|resumeProjectHeading|begin\{itemize\})/.test(content);
  return (
    <>
      {zoomBar}
      <MarkdownPreview
        content={md}
        theme={theme}
        sourceMap={exact}
        allowHtml={isLatex}
        articleRef={(el) => { previewDocRef.current = el; }}
        onSourceJump={onSourceJump}
        zoom={zoom}
        compact={isResume}
      />
    </>
  );
}
