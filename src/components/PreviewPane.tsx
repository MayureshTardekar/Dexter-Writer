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
          <button className="btn xs ghost" onClick={onCompilePdf} disabled={compilingPdf} title="Compile with latex.js (browser)">
            {compilingPdf ? "Compiling..." : "Compile PDF"}
          </button>
        </span>
      )}
    </div>
  );
}

// Markdown / LaTeX rich preview
function MarkdownPreview({ content, theme = "dark", sourceMap = true, allowHtml = false, onSourceJump, zoom = 1.0 }: {
  content: string; theme?: "dark" | "light"; sourceMap?: boolean; allowHtml?: boolean; onSourceJump?: (info: SourceJump) => void; zoom?: number;
}) {
  const rehypePlugins = useMemo(() => {
    const plugins: unknown[] = [rehypeKatex];
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
        <article className="preview-doc">
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

// PDF compilation via latex.js
type PdfState = { status: "idle" } | { status: "compiling" } | { status: "ready"; url: string } | { status: "error"; message: string };

async function compileWithLatexJs(source: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;opacity:0;pointer-events:none;border:0;";
    document.body.appendChild(iframe);

    const cleanup = () => { try { document.body.removeChild(iframe); } catch { /* ignore */ } };
    const timeoutHandle = setTimeout(() => {
      window.removeEventListener("message", handler);
      cleanup();
      reject(new Error("Compilation timed out (30s). The latex.js CDN may be unavailable."));
    }, 30_000);

    const handler = (ev: MessageEvent) => {
      if (!ev.data || ev.data.type !== "__latexjs_done__") return;
      window.removeEventListener("message", handler);
      clearTimeout(timeoutHandle);
      cleanup();
      const res = ev.data as { type: string; ok: boolean; html?: string; err?: string };
      if (res.ok && res.html) {
        const blob = new Blob([res.html], { type: "text/html" });
        resolve(URL.createObjectURL(blob));
      } else {
        reject(new Error(res.err ?? "Unknown latex.js error"));
      }
    };
    window.addEventListener("message", handler);

    const escapedSource = JSON.stringify(source);
    iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8">
<script>window.onerror=function(m){window.parent.postMessage({type:"__latexjs_done__",ok:false,err:String(m)},"*");}<\/script>
</head><body>
<script type="module">
try {
  const mod = await import("https://cdn.jsdelivr.net/npm/latex.js@0.12.4/dist/latex.mjs");
  const src = ${escapedSource};
  const generator = mod.parse(src,{});
  const frag = generator.domFragment ? generator.domFragment() : generator.document;
  const ser = new XMLSerializer();
  let body="";
  if(frag&&frag.children){for(const ch of frag.children)body+=ser.serializeToString(ch);}
  else{body=ser.serializeToString(frag);}
  const style="body{font-family:Georgia,serif;font-size:11pt;line-height:1.65;max-width:720px;margin:0 auto;padding:48px 60px 72px;background:#fff;color:#1a1a1a;}h1{font-size:20pt;text-align:center;margin:0 0 4px;}h2{font-size:11pt;text-transform:uppercase;letter-spacing:.1em;border-bottom:1.5px solid #111;padding-bottom:2px;margin:18px 0 5px;}h3{font-size:11pt;margin:8px 0 2px;}ul{margin:3px 0 6px 18px;}li{margin:2px 0;}a{color:#1a56b0;text-decoration:none;}p{margin:4px 0 6px;}";
  const html="<!DOCTYPE html><html><head><meta charset=utf-8><style>"+style+"</style></head><body>"+body+"</body></html>";
  window.parent.postMessage({type:"__latexjs_done__",ok:true,html},"*");
} catch(e){
  window.parent.postMessage({type:"__latexjs_done__",ok:false,err:String(e.message||e)},"*");
}
<\/script></body></html>`;
  });
}

// Root export
export default function PreviewPane({ content, mode, theme, onSourceJump }: {
  content: string; mode: DocMode; theme?: "dark" | "light"; onSourceJump?: (info: SourceJump) => void;
}) {
  const [zoom, setZoom] = useState(1.0);
  const [pdfState, setPdfState] = useState<PdfState>({ status: "idle" });
  const [pdfMode, setPdfMode] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => { return () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); }; }, []);

  const compilePdf = useCallback(async () => {
    setPdfState({ status: "compiling" });
    setPdfMode(false);
    try {
      const url = await compileWithLatexJs(content);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = url;
      setPdfState({ status: "ready", url });
      setPdfMode(true);
    } catch (e) {
      setPdfState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [content]);

  const md = useMemo(() => {
    if (mode === "latex") return latexToReadable(content);
    if (mode === "typst") return typstToReadable(content);
    return content;
  }, [content, mode]);

  const isLatex = mode === "latex";
  const compilingPdf = pdfState.status === "compiling";
  const pdfReady = pdfState.status === "ready";
  const pdfUrl = pdfReady ? (pdfState as { status: "ready"; url: string }).url : null;
  const pdfError = pdfState.status === "error" ? (pdfState as { status: "error"; message: string }).message : null;

  const zoomBar = (
    <ZoomBar zoom={zoom} onZoom={setZoom} mode={mode}
      onCompilePdf={isLatex ? compilePdf : undefined}
      compilingPdf={compilingPdf} pdfReady={pdfReady} pdfMode={pdfMode}
      onTogglePdf={() => setPdfMode((v) => !v)}
    />
  );

  if (isLatex && pdfMode && pdfUrl) {
    return (
      <>
        {zoomBar}
        <div className="preview-pdf-wrap">
          <iframe className="preview-pdf-frame" src={pdfUrl} title="Compiled LaTeX output" sandbox="allow-scripts allow-same-origin" />
          <div className="preview-pdf-status">Rendered via latex.js in browser</div>
        </div>
      </>
    );
  }

  if (mode === "typst") {
    return (<>{zoomBar}<TypstPreview content={content} onSourceJump={onSourceJump} zoom={zoom} /></>);
  }

  const exact = mode === "markdown";
  return (
    <>
      {zoomBar}
      {compilingPdf && <div className="preview-pdf-status compiling">Compiling LaTeX...</div>}
      {pdfError && <div className="preview-pdf-status error">Compilation failed: {pdfError}</div>}
      <MarkdownPreview content={md} theme={theme} sourceMap={exact} allowHtml={isLatex} onSourceJump={onSourceJump} zoom={zoom} />
    </>
  );
}
