import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import { gunzipSyncTex, parseSyncTex, forwardSearch, type SyncTexData } from '../lib/synctex';
// Bundled worker (same version as the API): no CDN, works offline, no parse cost at runtime.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_PAGES = 12;
const BASE_SCALE = 1.6;
// Cap effective render scale: a letter page at 3x is ~27MB of bitmap per
// page — unbounded zoom × 12 pages is how tabs die with Out of Memory.
const MAX_EFFECTIVE_SCALE = 2.5;

interface Props {
  pdfData: Uint8Array;
  synctex: Uint8Array | null;
  zoom: number;
  onJump: (line: number) => void;
}

/**
 * Clickable PDF view (Overleaf-style inverse search).
 * Rendered with PDF.js on canvas; clicks map to source lines via SyncTeX.
 * Additive alternative to the native iframe viewer — that default is untouched.
 */
export default function SyncTexPdfView({ pdfData, synctex, zoom, onJump }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [sync, setSync] = useState<SyncTexData | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [renderGen, setRenderGen] = useState(0);
  const scalesRef = useRef(new Map<number, number>());
  const hintTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (hintTimer.current) window.clearTimeout(hintTimer.current);
    };
  }, []);

  // Load the PDF document (cancelled safely on unmount / new data).
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setPageCount(0);
    setLoadError(null);
    let proxy: PDFDocumentProxy | null = null;
    getDocument({ data: pdfData })
      .promise.then((d) => {
        if (cancelled) {
          void d.cleanup().catch(() => {});
          return;
        }
        proxy = d;
        setDoc(d);
        setPageCount(Math.min(d.numPages, MAX_PAGES));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      if (proxy) void proxy.cleanup().catch(() => {});
    };
  }, [pdfData]);

  // Gunzip + parse SyncTeX (independent of PDF rendering).
  useEffect(() => {
    let cancelled = false;
    setSync(null);
    setSyncError(null);
    if (!synctex) {
      setSyncError('No SyncTeX data in this compile.');
      return;
    }
    gunzipSyncTex(synctex)
      .then((text) => {
        if (cancelled) return;
        const data = parseSyncTex(text);
        if (data.nodes.length === 0) setSyncError('SyncTeX parsed, but no line mappings found.');
        else setSync(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setSyncError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [synctex]);

  const pages = useMemo(() => Array.from({ length: pageCount }, (_, i) => i + 1), [pageCount]);

  // Render (or re-render on zoom change). Generation counter drops stale draws.
  useEffect(() => {
    if (!doc) return;
    const gen = renderGen + 1;
    setRenderGen(gen);
    let cancelled = false;
    const timers: Array<{ cancel: () => void }> = [];
    const liveCanvases: HTMLCanvasElement[] = [];
    void (async () => {
      for (const n of pages) {
        if (cancelled) return;
        try {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-sync-page="${n}"]`);
          if (!canvas) continue;
          const scale = Math.min(zoom * BASE_SCALE, MAX_EFFECTIVE_SCALE);
          const viewport = page.getViewport({ scale });
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          liveCanvases.push(canvas);
          scalesRef.current.set(n, scale);
          const task = page.render({ canvas, viewport });
          timers.push(task);
          await task.promise;
        } catch {
          // Cancelled renders reject — safe to ignore.
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const t of timers) {
        try { t.cancel(); } catch { /* noop */ }
      }
      // Release bitmap memory immediately instead of waiting for GC.
      for (const c of liveCanvases) {
        c.width = 0;
        c.height = 0;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, zoom, pages]);

  function flashHint(msg: string) {
    setHint(msg);
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 2200);
  }

  function onPageClick(e: RMouseEvent<HTMLDivElement>, pageNum: number) {
    if (!sync) {
      flashHint(syncError ?? 'SyncTeX data still loading…');
      return;
    }
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const s = scalesRef.current.get(pageNum) ?? Math.min(zoom * BASE_SCALE, MAX_EFFECTIVE_SCALE);
    const ptX = (e.clientX - rect.left) / s;
    const ptY = (e.clientY - rect.top) / s;
    const hit = forwardSearch(sync, pageNum, ptX, ptY);
    if (hit) onJump(hit.line);
    else flashHint('No source mapping here — try clicking body text.');
  }

  if (loadError) {
    return <div className="typst-diag-list">PDF render failed: {loadError}</div>;
  }

  return (
    <div className="preview-scroll">
      <div className="typst-status muted small">
        <span>🔗 Click any line to jump to source{sync ? '' : ' (mapping…)'}</span>
        {syncError && <span className="typst-diag"> · {syncError}</span>}
        {hint && <span> · {hint}</span>}
      </div>
      {!doc && <div className="muted small" style={{ padding: 16 }}>Rendering PDF…</div>}
      {pages.map((n) => (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          key={n}
          className="sync-page"
          data-page={n}
          onClick={(e) => onPageClick(e, n)}
          title="Click to jump to source line"
          style={{ position: 'relative', margin: '0 auto 14px', cursor: sync ? 'crosshair' : 'default', width: 'fit-content', maxWidth: '100%' }}
        >
          <canvas data-sync-page={n} style={{ display: 'block', maxWidth: '100%', background: '#fff', borderRadius: 4, boxShadow: '0 2px 14px rgba(0,0,0,0.28)' }} />
        </div>
      ))}
      {doc && doc.numPages > MAX_PAGES && (
        <div className="muted small" style={{ textAlign: 'center', paddingBottom: 12 }}>
          Showing first {MAX_PAGES} of {doc.numPages} pages in clickable view.
        </div>
      )}
    </div>
  );
}
