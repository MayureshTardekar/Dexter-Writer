import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { latexToReadable, typstToReadable } from '../lib/docUtils';
import { rehypeSourceLine } from '../lib/rehypeSourceLine';
import { renderTypstSvg, warmupTypstEngine } from '../lib/typstEngine';
import type { DocMode } from '../lib/templates';
import MermaidBlock from './MermaidBlock';

/** Inverse-search payload: exact line when known, else text to fuzzy-match. */
export interface SourceJump {
  line?: number;
  text: string;
}

function handlePreviewDblClick(e: RMouseEvent, allowLine: boolean, onSourceJump?: (info: SourceJump) => void): void {
  if (!onSourceJump) return;
  const t = e.target as HTMLElement;
  const lined = t.closest?.('[data-source-line]') as HTMLElement | null;
  if (allowLine && lined?.dataset.sourceLine) {
    onSourceJump({ line: Number(lined.dataset.sourceLine), text: (lined.textContent || '').slice(0, 120) });
    return;
  }
  const block = t.closest?.('h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote,pre') as HTMLElement | null;
  const text = ((block?.textContent || t.textContent) || '').trim();
  if (text) onSourceJump({ text: text.slice(0, 120) });
}

function MarkdownPreview({ content, theme = 'dark', sourceMap = true, onSourceJump }: { content: string; theme?: 'dark' | 'light'; sourceMap?: boolean; onSourceJump?: (info: SourceJump) => void }) {
  const rehypePlugins = useMemo(() => (sourceMap ? [rehypeKatex, rehypeSourceLine] : [rehypeKatex]), [sourceMap]);
  if (!content.trim()) {
    return (
      <div className="preview-scroll">
        <div className="preview-empty">
          <p><strong>Empty document</strong></p>
          <p>Start typing in the editor — the preview renders here instantly,<br />including math like $E=mc^2$ and diagrams.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="preview-scroll" onDoubleClick={(e) => handlePreviewDblClick(e, sourceMap, onSourceJump)} title="Double-click to jump to source">
      <article className="preview-doc">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={rehypePlugins}
          components={{
            code(props) {
              const { children, className, ...rest } = props;
              const match = /language-(\w+)/.exec(className || '');
              if (match && match[1] === 'mermaid') {
                return <MermaidBlock chart={String(children).replace(/\n$/, '')} theme={theme} />;
              }
              return (
                <code {...rest} className={className}>
                  {children}
                </code>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}

function TypstPreview({ content, onSourceJump }: { content: string; onSourceJump?: (info: SourceJump) => void }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    warmupTypstEngine();
  }, []);

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
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [content]);

  if (svg) {
    return (
      <div className="preview-scroll typst">
        <div className="typst-status muted small">
          {compiling ? '⟳ recompiling…' : `⚡ Typst WASM${ms != null ? ` · ${ms}ms` : ''}`}
          {diagnostics.length > 0 && <span className="typst-diag"> · ⚠️ {diagnostics.length} diagnostic{diagnostics.length === 1 ? '' : 's'}</span>}
        </div>
        {diagnostics.length > 0 && (
          <pre className="typst-diag-list">{diagnostics.slice(0, 8).join('\n')}</pre>
        )}
        {/* eslint-disable-next-line react/no-danger */}
        <div className="typst-svg" dangerouslySetInnerHTML={{ __html: svg }} onDoubleClick={(e) => handlePreviewDblClick(e, false, onSourceJump)} title="Double-click to jump to source" />
      </div>
    );
  }
  // Fallback: readable markdown render while engine loads or on error
  // (line numbers refer to transformed text, so only text search applies)
  return (
    <div className="preview-scroll" onDoubleClick={(e) => handlePreviewDblClick(e, false, onSourceJump)} title="Double-click to jump to source">
      <div className="typst-status muted small">{compiling ? '⟳ loading Typst engine…' : error ? `❌ ${error}` : ''}</div>
      {diagnostics.length > 0 && <pre className="typst-diag-list">{diagnostics.slice(0, 8).join('\n')}</pre>}
      <article className="preview-doc">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {typstToReadable(content)}
        </ReactMarkdown>
      </article>
    </div>
  );
}

export default function PreviewPane({ content, mode, theme, onSourceJump }: { content: string; mode: DocMode; theme?: 'dark' | 'light'; onSourceJump?: (info: SourceJump) => void }) {
  const md = useMemo(() => {
    if (mode === 'latex') return latexToReadable(content);
    if (mode === 'typst') return typstToReadable(content);
    return content;
  }, [content, mode]);
  if (mode === 'typst') return <TypstPreview content={content} onSourceJump={onSourceJump} />;
  // LaTeX preview is transformed text: line numbers don't map back, use text search.
  const exact = mode === 'markdown';
  return <MarkdownPreview content={md} theme={theme} sourceMap={exact} onSourceJump={onSourceJump} />;
}
