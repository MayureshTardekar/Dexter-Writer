import type { TypstCompiler, TypstRenderer } from '@myriaddreamin/typst.ts';

// Phase 2: Typst WebAssembly engine (ROADMAP v1.0).
// The compiler + renderer WASM is lazy-loaded on first Typst use so the
// main bundle stays lean. Fonts/WASM stream from CDN at runtime; every
// failure mode degrades to the markdown-fallback preview + print-to-PDF.

const MAIN_PATH = '/main.typ';

export type TypstEngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TypstArtifact {
  pdf?: Uint8Array;
  vector?: Uint8Array;
  svg?: string;
  diagnostics: string[];
  error?: string;
  compileMs?: number;
}

interface Engine {
  compiler: TypstCompiler;
  renderer: TypstRenderer;
  FormatEnum: typeof import('@myriaddreamin/typst.ts/compiler').CompileFormatEnum;
}

let enginePromise: Promise<Engine> | null = null;
let engineError: string | null = null;

export function typstEngineError(): string | null {
  return engineError;
}

async function loadEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = (async (): Promise<Engine> => {
      const [idx, sub] = await Promise.all([import('@myriaddreamin/typst.ts'), import('@myriaddreamin/typst.ts/compiler')]);
      const compiler = idx.createTypstCompiler();
      await compiler.init({ beforeBuild: [idx.preloadRemoteFonts([], { assets: ['text'] })] });
      const renderer = idx.createTypstRenderer();
      await renderer.init();
      return { compiler, renderer, FormatEnum: sub.CompileFormatEnum };
    })();
    enginePromise.catch((e: unknown) => {
      engineError = e instanceof Error ? e.message : String(e);
      enginePromise = null;
    });
  }
  return enginePromise;
}

const artifactCache = new Map<string, Promise<TypstArtifact>>();
const MAX_CACHE = 8;

function cacheKey(kind: string, source: string): string {
  let h = 0;
  for (let i = 0; i < source.length; i++) h = (Math.imul(h, 31) + source.charCodeAt(i)) | 0;
  return `${kind}:${source.length}:${h}`;
}

function remember(key: string, p: Promise<TypstArtifact>): Promise<TypstArtifact> {
  artifactCache.set(key, p);
  if (artifactCache.size > MAX_CACHE) {
    const first = artifactCache.keys().next().value;
    if (first) artifactCache.delete(first);
  }
  return p;
}

/** Compile Typst source to vector PDF bytes + unix diagnostics. */
export function compileTypstPdf(source: string): Promise<TypstArtifact> {
  const key = cacheKey('pdf', source);
  const hit = artifactCache.get(key);
  if (hit) return hit;
  return remember(
    key,
    (async (): Promise<TypstArtifact> => {
      const t0 = performance.now();
      try {
        const engine = await loadEngine();
        engine.compiler.addSource(MAIN_PATH, source);
        const res = await engine.compiler.compile({ mainFilePath: MAIN_PATH, format: engine.FormatEnum.pdf, diagnostics: 'unix' });
        return {
          pdf: res.result ? new Uint8Array(res.result) : undefined,
          diagnostics: (res.diagnostics ?? []) as string[],
          error: res.result ? undefined : 'Compilation produced no PDF.',
          compileMs: Math.round(performance.now() - t0),
        };
      } catch (e) {
        return { diagnostics: [], error: e instanceof Error ? e.message : String(e) };
      }
    })(),
  );
}

/** Compile to vector artifact and render the full document to an SVG string for preview. */
export function renderTypstSvg(source: string): Promise<TypstArtifact> {
  const key = cacheKey('svg', source);
  const hit = artifactCache.get(key);
  if (hit) return hit;
  return remember(
    key,
    (async (): Promise<TypstArtifact> => {
      const t0 = performance.now();
      try {
        const engine = await loadEngine();
        engine.compiler.addSource(MAIN_PATH, source);
        const res = await engine.compiler.compile({ mainFilePath: MAIN_PATH, format: engine.FormatEnum.vector, diagnostics: 'unix' });
        const diagnostics = (res.diagnostics ?? []) as string[];
        if (!res.result) return { diagnostics, error: 'Compilation produced no output.' };
        const vector = new Uint8Array(res.result);
        const svg = await engine.renderer.renderSvg({ format: 'vector', artifactContent: vector });
        return { vector, svg, diagnostics, compileMs: Math.round(performance.now() - t0) };
      } catch (e) {
        return { diagnostics: [], error: e instanceof Error ? e.message : String(e) };
      }
    })(),
  );
}

/** Fire-and-forget warmup so first compile feels instant. */
export function warmupTypstEngine(): void {
  loadEngine().catch(() => {});
}
