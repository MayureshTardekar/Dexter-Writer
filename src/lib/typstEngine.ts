import type { CompileFile } from './projectRuntime';
import { compilerCacheKey } from './compilerFiles';
import { projectPath } from './projectPaths';
import type { TypstCompiler, TypstRenderer } from '@myriaddreamin/typst.ts';

// Phase 2: Typst WebAssembly engine (ROADMAP v1.0).
// The compiler + renderer WASM is lazy-loaded on first Typst use so the
// main bundle stays lean. Fonts/WASM stream from CDN at runtime; every
// failure mode degrades to the markdown-fallback preview + print-to-PDF.

let compileQueue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> { const task = compileQueue.then(fn); compileQueue = task.catch(() => {}); return task; }
function prepare(engine: Engine, source: string, files: CompileFile[], main: string) {
  engine.compiler.resetShadow();
  for (const f of files) engine.compiler.mapShadow('/' + projectPath(f.path), typeof f.content === 'string' ? new TextEncoder().encode(f.content) : f.content);
  engine.compiler.mapShadow('/' + projectPath(main), new TextEncoder().encode(source));
}

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


function remember(key: string, p: Promise<TypstArtifact>): Promise<TypstArtifact> {
  artifactCache.set(key, p);
  if (artifactCache.size > MAX_CACHE) {
    const first = artifactCache.keys().next().value;
    if (first) artifactCache.delete(first);
  }
  return p;
}

/** Compile Typst source to vector PDF bytes + unix diagnostics. */
export function compileTypstPdf(source: string, files: CompileFile[] = [], main = 'main.typ'): Promise<TypstArtifact> {
  const key = 'pdf:' + compilerCacheKey(source, files, main);
  const hit = artifactCache.get(key);
  if (hit) return hit;
  return remember(
    key,
    serial(async (): Promise<TypstArtifact> => {
      const t0 = performance.now();
      try {
        const engine = await loadEngine();
        prepare(engine, source, files, main);
        const res = await engine.compiler.compile({ mainFilePath: '/' + projectPath(main), format: engine.FormatEnum.pdf, diagnostics: 'unix' });
        return {
          pdf: res.result ? new Uint8Array(res.result) : undefined,
          diagnostics: (res.diagnostics ?? []) as string[],
          error: res.result ? undefined : 'Compilation produced no PDF.',
          compileMs: Math.round(performance.now() - t0),
        };
      } catch (e) {
        return { diagnostics: [], error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}

/** Compile to vector artifact and render the full document to an SVG string for preview. */
export function renderTypstSvg(source: string, files: CompileFile[] = [], main = 'main.typ'): Promise<TypstArtifact> {
  const key = 'svg:' + compilerCacheKey(source, files, main);
  const hit = artifactCache.get(key);
  if (hit) return hit;
  return remember(
    key,
    serial(async (): Promise<TypstArtifact> => {
      const t0 = performance.now();
      try {
        const engine = await loadEngine();
        prepare(engine, source, files, main);
        const res = await engine.compiler.compile({ mainFilePath: '/' + projectPath(main), format: engine.FormatEnum.vector, diagnostics: 'unix' });
        const diagnostics = (res.diagnostics ?? []) as string[];
        if (!res.result) return { diagnostics, error: 'Compilation produced no output.' };
        const vector = new Uint8Array(res.result);
        const svg = await engine.renderer.renderSvg({ format: 'vector', artifactContent: vector });
        return { vector, svg, diagnostics, compileMs: Math.round(performance.now() - t0) };
      } catch (e) {
        return { diagnostics: [], error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}

/** Fire-and-forget warmup so first compile feels instant. */
export function warmupTypstEngine(): void {
  loadEngine().catch(() => {});
}
