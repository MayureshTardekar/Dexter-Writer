import { BusyTexRunner, PdfLatex } from 'texlyre-busytex';

export interface LatexCompileResult {
  success: boolean;
  pdf?: Uint8Array;
  pdfUrl?: string;
  log?: string;
  error?: string;
  compileMs?: number;
  /** Pages reported by pdfTeX ("Output written … (N pages, …)"), null if unknown. */
  pages?: number | null;
  /** Deduplicated interesting log lines (overfull boxes, warnings, errors). */
  warnings?: string[];
}

export interface TexLogSummary {
  pages: number | null;
  warnings: string[];
}

/**
 * Parse a pdfTeX log for the page count and actionable warnings.
 * Pure function — safe to unit test.
 */
export function parseTexLog(log: string): TexLogSummary {
  if (!log) return { pages: null, warnings: [] };
  let pages: number | null = null;
  const out = /Output written on \S+ \((\d+) pages?,/m.exec(log);
  if (out) pages = parseInt(out[1], 10);
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const raw of log.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const interesting =
      line.startsWith('Overfull ') ||
      line.startsWith('Underfull ') ||
      line.startsWith('LaTeX Warning:') ||
      line.startsWith('LaTeX Font Warning:') ||
      line.startsWith('! ') ||
      /File .* not found/.test(line);
    if (!interesting) continue;
    const short = line.length > 140 ? `${line.slice(0, 140)}…` : line;
    if (seen.has(short)) continue;
    seen.add(short);
    warnings.push(short);
    if (warnings.length >= 8) break;
  }
  return { pages, warnings };
}

export type LatexEngineStatus = 'idle' | 'loading' | 'ready' | 'compiling' | 'error';

interface EngineInstance {
  runner: BusyTexRunner;
  pdflatex: PdfLatex;
  bundledStyles: { path: string; content: string }[];
}

let enginePromise: Promise<EngineInstance> | null = null;
let engineError: string | null = null;
let engineReady = false;

/** True once the WASM engine finished initializing (downloads complete). */
export function isLatexEngineReady(): boolean {
  return engineReady;
}

/**
 * Extended TeX Live slices, fetched ON DEMAND only when a document needs a
 * package outside the slim preload. Ordered small → large. Each entry is
 * downloaded at most once per session and persists in IndexedDB afterwards.
 */
const EXTRA_SLICES: Array<{ url: string; label: string }> = [
  { url: '/core/busytex/texlive-recommended.js', label: '~190 MB extended packages' },
  { url: '/core/busytex/texlive-extra.js', label: '~326 MB full packages' },
];
const loadedSlices: string[] = [];

/** Extract a missing filename from a pdfTeX log (`File 'x.sty' not found`). */
export function findMissingPackage(log: string): string | null {
  if (!log) return null;
  const m = /File `([^']+?)' not found/.exec(log);
  return m ? m[1] : null;
}

const LAMBDA_STORAGE_KEY = 'dexter_latex_lambda_url';

/**
 * Returns the configured AWS Lambda compiler URL.
 * Checks localStorage first, then Vite environment variable `VITE_LATEX_LAMBDA_URL`.
 */
export function getLambdaUrl(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const custom = localStorage.getItem(LAMBDA_STORAGE_KEY);
      if (custom && custom.trim()) return custom.trim();
    }
  } catch {}
  const envUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_LATEX_LAMBDA_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) return envUrl.trim();
  return null;
}

/**
 * Configures or clears a custom AWS Lambda compiler URL in browser storage.
 */
export function setLambdaUrl(url: string | null): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (url && url.trim()) {
        localStorage.setItem(LAMBDA_STORAGE_KEY, url.trim());
      } else {
        localStorage.removeItem(LAMBDA_STORAGE_KEY);
      }
    }
  } catch {}
}

/**
 * Returns true if a remote AWS Lambda compiler is configured.
 */
export function isRemoteCompilerConfigured(): boolean {
  return Boolean(getLambdaUrl());
}

export function latexEngineError(): string | null {
  return engineError;
}

let currentStatus: LatexEngineStatus = 'idle';
let currentProgress = 0;
const statusListeners = new Set<(status: LatexEngineStatus, progress: number, message?: string) => void>();

export function subscribeLatexStatus(cb: (status: LatexEngineStatus, progress: number, message?: string) => void): () => void {
  statusListeners.add(cb);
  cb(currentStatus, currentProgress);
  return () => { statusListeners.delete(cb); };
}

function notifyStatus(status: LatexEngineStatus, progress: number, message?: string) {
  currentStatus = status;
  currentProgress = progress;
  statusListeners.forEach((cb) => cb(status, progress, message));
}

const COMMON_STY_FILES = [
  'titlesec.sty',
  'enumitem.sty',
  'fullpage.sty',
  'marvosym.sty'
];

async function loadBundledStyles(): Promise<{ path: string; content: string }[]> {
  const loaded: { path: string; content: string }[] = [];
  await Promise.all(
    COMMON_STY_FILES.map(async (filename) => {
      try {
        const res = await fetch(`/core/busytex/${filename}`);
        if (res.ok) {
          const content = await res.text();
          if (content && !content.startsWith('<html') && !content.startsWith('<!DOCTYPE')) {
            loaded.push({ path: filename, content });
          }
        }
      } catch (err) {
        console.warn(`Failed to preload ${filename}:`, err);
      }
    })
  );
  return loaded;
}

export async function initLatexEngine(): Promise<EngineInstance> {
  if (!enginePromise) {
    notifyStatus('loading', 10, 'Downloading TeX engine (one-time ~120 MB, cached offline)…');
    enginePromise = (async () => {
      try {
        notifyStatus('loading', 25, 'Loading TeX Live packages…');
        const bundledStyles = await loadBundledStyles();

        const runner = new BusyTexRunner({
          busytexBasePath: '/core/busytex',
          // Slim preload: engine WASM (~31 MB) + basic slice (~88 MB).
          // Covers article class, math, hyperref, geometry, fonts, tables.
          // enumitem/titlesec arrive via bundled .sty overlays; anything
          // else escalates on demand (see compileLatexPdf).
          preloadDataPackages: [
            '/core/busytex/texlive-basic.js',
          ],
          onDownloadProgress: (progress) => {
            const pct = Math.min(95, Math.round(25 + progress.percent * 0.7));
            notifyStatus('loading', pct, `Loading TeX packages: ${Math.round(progress.percent)}%`);
          }
        });

        // Initialize without worker first for compatibility, or with worker
        await runner.initialize(true);

        const pdflatex = new PdfLatex(runner);
        engineReady = true;
        notifyStatus('ready', 100, 'TeX Engine Ready');
        return { runner, pdflatex, bundledStyles };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        engineError = msg;
        notifyStatus('error', 0, `Engine error: ${msg}`);
        enginePromise = null;
        throw err;
      }
    })();
  }
  return enginePromise;
}

export function warmupLatexEngine(): void {
  void initLatexEngine().catch(() => {});
}

// In-memory cache for compiled PDFs
const cache = new Map<string, Promise<LatexCompileResult>>();
const MAX_CACHE = 8;

function getCacheKey(source: string, extraFiles?: { path: string; content: string }[]): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (Math.imul(hash, 31) + source.charCodeAt(i)) | 0;
  const extraLen = extraFiles?.reduce((acc, f) => acc + f.content.length, 0) || 0;
  return `tex:${source.length}:${extraLen}:${hash}`;
}

let activeBlobUrl: string | null = null;

/**
 * Compiles LaTeX source via remote AWS Lambda function.
 * Returns the compiled PDF as a blob URL with page count and timings.
 */
export async function compileWithLambda(
  source: string,
  lambdaUrl: string
): Promise<LatexCompileResult> {
  const t0 = performance.now();
  notifyStatus('compiling', 40, 'Compiling LaTeX with AWS Lambda…');

  const res = await fetch(lambdaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tex: source }),
  });

  const compileMs = Math.round(performance.now() - t0);

  if (!res.ok) {
    let errMsg = `Cloud compilation failed (HTTP ${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson.error) errMsg = errJson.error;
    } catch {
      const text = await res.text();
      if (text) errMsg = text;
    }
    notifyStatus('error', 100, errMsg);
    return {
      success: false,
      error: errMsg,
      compileMs,
    };
  }

  const blob = await res.blob();
  const pdfBuffer = new Uint8Array(await blob.arrayBuffer());

  if (activeBlobUrl) {
    URL.revokeObjectURL(activeBlobUrl);
  }
  const pdfUrl = URL.createObjectURL(blob);
  activeBlobUrl = pdfUrl;

  const pageCountHdr = res.headers.get('X-Page-Count');
  const pages = pageCountHdr ? parseInt(pageCountHdr, 10) : null;

  notifyStatus('ready', 100, `Compiled via AWS Lambda in ${compileMs}ms`);
  return {
    success: true,
    pdf: pdfBuffer,
    pdfUrl,
    compileMs,
    pages,
    warnings: [],
  };
}

export async function compileLatexPdf(
  source: string,
  extraFiles: { path: string; content: string }[] = []
): Promise<LatexCompileResult> {
  const key = getCacheKey(source, extraFiles);
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<LatexCompileResult> => {
    const t0 = performance.now();

    // 1. Prefer AWS Lambda if configured and online (Zero MB client download)
    const lambdaUrl = getLambdaUrl();
    const canUseRemote = Boolean(lambdaUrl && (typeof navigator === 'undefined' || navigator.onLine));

    if (canUseRemote && lambdaUrl) {
      try {
        const remoteRes = await compileWithLambda(source, lambdaUrl);
        if (remoteRes.success) return remoteRes;
        // If compilation failed with actual LaTeX syntax errors, return immediately
        if (remoteRes.error && !remoteRes.error.includes('Failed to fetch') && !remoteRes.error.includes('NetworkError')) {
          return remoteRes;
        }
      } catch (err) {
        console.warn('AWS Lambda compiler network error, falling back to local WASM:', err);
        notifyStatus('loading', 20, 'Cloud compiler unreachable. Falling back to local WASM…');
      }
    }

    notifyStatus('compiling', 50, 'Compiling LaTeX with pdfTeX…');

    try {
      const engine = await initLatexEngine();

      // Combine bundled packages with user extra files
      const allFiles = [...engine.bundledStyles, ...extraFiles];

      const runAttempt = (slices: string[]) =>
        engine.pdflatex.compile({
          input: source,
          rerun: true,
          additionalFiles: allFiles,
          ...(slices.length > 0 ? { dataPackagesJs: slices } : {}),
        });

      let res = await runAttempt([...loadedSlices]);

      // On-demand escalation: if the log reports a missing file, fetch the
      // next extended slice and retry (once per slice). Downloads persist in
      // IndexedDB, so each slice is fetched at most once per device.
      let missing = (!res.success || !res.pdf?.length) ? findMissingPackage(res.log || '') : null;
      while (missing) {
        const next = EXTRA_SLICES.find((s) => !loadedSlices.includes(s.url));
        if (!next) break;
        notifyStatus('loading', 70, `Document needs ${missing} — fetching ${next.label} (one-time, cached)…`);
        loadedSlices.push(next.url);
        res = await runAttempt([...loadedSlices]);
        if (res.success && res.pdf?.length) break;
        missing = findMissingPackage(res.log || '');
      }

      const compileMs = Math.round(performance.now() - t0);

      if (res.success && res.pdf && res.pdf.length > 0) {
        if (activeBlobUrl) {
          URL.revokeObjectURL(activeBlobUrl);
        }
        const blob = new Blob([res.pdf as unknown as BlobPart], { type: 'application/pdf' });
        const pdfUrl = URL.createObjectURL(blob);
        activeBlobUrl = pdfUrl;

        notifyStatus('ready', 100, `Compiled in ${compileMs}ms`);
        const summary = parseTexLog(res.log || '');
        return {
          success: true,
          pdf: res.pdf,
          pdfUrl,
          log: res.log,
          compileMs,
          pages: summary.pages,
          warnings: summary.warnings,
        };
      }

      // If compilation failed, extract user-friendly error from log
      const logText = res.log || '';
      let errMsg = 'LaTeX compilation failed.';
      const errMatch = logText.match(/!\s+(.*(?:\n\s+.*){0,2})/);
      if (errMatch) {
        errMsg = errMatch[1].trim();
      }

      notifyStatus('error', 100, errMsg);
      const failSummary = parseTexLog(logText);
      return {
        success: false,
        log: logText,
        error: errMsg,
        compileMs,
        pages: failSummary.pages,
        warnings: failSummary.warnings,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notifyStatus('error', 0, msg);
      return {
        success: false,
        error: msg,
        compileMs: Math.round(performance.now() - t0),
      };
    }
  })();

  cache.set(key, promise);
  if (cache.size > MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }

  return promise;
}
