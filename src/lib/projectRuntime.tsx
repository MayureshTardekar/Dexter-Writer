import { createContext, useContext } from 'react';
import type { ProjectFile } from './projectFiles';
import type { ProjectAsset } from './assets';
import { projectPath, relativeProjectPath, resolveProjectPath } from './projectPaths';
import { documentReferences } from './validateProject';

export interface CompileFile { path: string; content: string | Uint8Array }
export interface ProjectRuntime {
  files: ProjectFile[]; assets: ProjectAsset[]; urls: Record<string, string>; activeName: string; revision: number;
}
export const ProjectContext = createContext<ProjectRuntime>({ files: [], assets: [], urls: {}, activeName: 'main.md', revision: 0 });
export const useProjectRuntime = () => useContext(ProjectContext);
/** Compilers run the main source at its real project path. */
export async function compileFiles(runtime: ProjectRuntime, main: string, source?: string): Promise<CompileFile[]> {
  const known = new Set([...runtime.files.map((f) => f.name), ...runtime.assets.map((a) => a.path)]);
  const needed = new Set<string>();
  function visit(name: string, text: string) {
    const localPackages = [...text.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)].flatMap((m) => m[1].split(',').map((p) => p.trim() + '.sty'));
    for (const ref of [...documentReferences(text), ...localPackages]) {
      let path: string;
      try { path = resolveProjectPath(name, decodeURI(ref)); } catch { continue; }
      const resolved = [path, ...['.tex', '.bib', '.png', '.jpg', '.jpeg', '.pdf'].map((ext) => path + ext)].find((p) => known.has(p));
      if (!resolved || resolved === main || needed.has(resolved)) continue;
      needed.add(resolved);
      const document = runtime.files.find((f) => f.name === resolved);
      if (document) visit(document.name, document.content);
    }
  }
  visit(main, source ?? runtime.files.find((f) => f.name === main)?.content ?? '');
  const files: CompileFile[] = runtime.files.filter((f) => needed.has(f.name)).map((f) => ({ path: projectPath(f.name), content: f.content }));
  for (const asset of runtime.assets.filter((a) => needed.has(a.path))) files.push({ path: projectPath(asset.path), content: new Uint8Array(await asset.blob.arrayBuffer()) });
  return files;
}
/** pdfTeX's string API uses a main.tex wrapper, preserving source-relative paths. */
export function latexMainSource(source: string, main: string): { source: string; mainFile?: CompileFile } {
  if (!main.includes('/')) return { source };
  const safe = projectPath(main);
  if (/[{}%#]/.test(safe)) throw new Error('Rename the main file to remove LaTeX special characters.');
  const directory = safe.slice(0, safe.lastIndexOf('/') + 1);
  return { source: `\\makeatletter\\def\\input@path{{${directory}}}\\makeatother\n\\input{${safe}}`, mainFile: { path: safe, content: source } };
}
export function referenceFrom(main: string, path: string): string { return relativeProjectPath(main, path); }

export async function compileLatexProject(runtime: ProjectRuntime, source: string, main = runtime.activeName) {
  const { compileLatexPdf } = await import('./latexEngine');
  const wrapped = latexMainSource(source, main);
  const extras = await compileFiles(runtime, main, source);
  if (wrapped.mainFile) extras.push(wrapped.mainFile);
  return compileLatexPdf(wrapped.source, extras);
}
export async function compileTypstProject(runtime: ProjectRuntime, source: string, main = runtime.activeName, format: 'pdf' | 'svg' = 'pdf') {
  const engine = await import('./typstEngine');
  const extras = await compileFiles(runtime, main, source);
  return format === 'pdf' ? engine.compileTypstPdf(source, extras, main) : engine.renderTypstSvg(source, extras, main);
}
