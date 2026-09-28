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
function MarkdownPreview({ content, theme = "dark", sourceMap = true, allowHtml = false, articleRef, onSourceJump, zoom = 1.0 }: {
  content: string; theme?: "dark" | "light"; sourceMap?: boolean; allowHtml?: boolean;
  articleRef?: React.RefCallback<HTMLElement>;
  onSourceJump?: (info: SourceJump) => void; zoom?: number;
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
        <article className="preview-doc" ref={articleRef}>
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

// PDF export via Browser Print API.
// latex.js cannot handle Jake's template packages (fontawesome5, fancyhdr,
// titlesec, fullpage, tabularx, etc.) — it crashes with 'setErrorFn' errors.
// Instead we capture the live rendered preview DOM, apply all its styles,
// and open a dedicated print window so the user can Save as PDF (Ctrl+P).
function printPreviewAsPdf(previewDocEl: HTMLElement | null): void {
  if (!previewDocEl) {
    alert('Preview is empty — type some LaTeX first.');
    return;
  }

  // Collect all stylesheets from the current document
  const styleLinks: string[] = [];
  const inlineStyles: string[] = [];
  document.querySelectorAll('link[rel="stylesheet"]').forEach((el) => {
    const href = (el as HTMLLinkElement).href;
    if (href) styleLinks.push(`<link rel="stylesheet" href="${href}">`);
  });
  document.querySelectorAll('style').forEach((el) => {
    inlineStyles.push(`<style>${el.textContent}</style>`);
  });

  // Clone the preview article element
  const clone = previewDocEl.cloneNode(true) as HTMLElement;

  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    alert('Pop-up blocked — please allow pop-ups for this site to export PDF.');
    return;
  }

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Resume — Export PDF</title>
  ${styleLinks.join('\n')}
  ${inlineStyles.join('\n')}
  <style>
    @page { size: A4; margin: 0; }
    html, body {
      margin: 0; padding: 0;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    /* Override dark-mode canvas; the cloned article already has white bg */
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
  <\/script>
</body>
</html>`);
  printWindow.document.close();
}

// Root export
export default function PreviewPane({ content, mode, theme, onSourceJump, compileTrigger }: {
  content: string; mode: DocMode; theme?: "dark" | "light"; onSourceJump?: (info: SourceJump) => void; compileTrigger?: number;
}) {
  const [zoom, setZoom] = useState(1.0);

  // Ref to the rendered <article class="preview-doc"> element for print capture
  const previewDocRef = useRef<HTMLElement | null>(null);

  const compilePdf = useCallback(() => {
    printPreviewAsPdf(previewDocRef.current);
  }, []);

  useEffect(() => {
    if (compileTrigger && compileTrigger > 0) {
      if (mode === "latex") {
        void compilePdf();
      }
    }
  }, [compileTrigger, mode, compilePdf]);

  const md = useMemo(() => {
    if (mode === "latex") return latexToReadable(content);
    if (mode === "typst") return typstToReadable(content);
    return content;
  }, [content, mode]);

  const isLatex = mode === "latex";
  const compilingPdf = false;   // print is synchronous — no loading state needed
  const pdfReady = false;
  const pdfError: string | null = null;

  const zoomBar = (
    <ZoomBar zoom={zoom} onZoom={setZoom} mode={mode}
      onCompilePdf={isLatex ? compilePdf : undefined}
      compilingPdf={compilingPdf} pdfReady={pdfReady} pdfMode={false}
      onTogglePdf={undefined}
    />
  );

  if (mode === "typst") {
    return (<>{zoomBar}<TypstPreview content={content} onSourceJump={onSourceJump} zoom={zoom} /></>);
  }

  const exact = mode === "markdown";
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
      />
    </>
  );
}
