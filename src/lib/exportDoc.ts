import { stripToPlainText } from './docUtils';
import type { DocMode } from './templates';
import { compileLatexProject, compileTypstProject, type ProjectRuntime } from './projectRuntime';
import { blobDataUrl } from './assets';
import { resolveProjectPath } from './projectPaths';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { downloadZip } from './zip';
import { toast } from './toast';
import type { ProjectFile } from './projectFiles';

export type ExportKind = 'pdf' | 'tex' | 'md' | 'html' | 'txt' | 'typ' | 'typst-pdf' | 'zip';

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildStandaloneHtml(title: string, bodyMarkdown: string, images: Record<string, string> = {}, main = 'main.md'): string {
  const body = renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeRaw, rehypeKatex],
    disallowedElements: ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'form', 'input'],
    components: { img: ({ src, alt, ...props }) => {
      let resolved: string | undefined;
      try { resolved = images[resolveProjectPath(main, decodeURI(String(src || '')))]; } catch { /* external ref */ }
      const value = resolved || (/^https?:/i.test(String(src)) ? src : undefined);
      return value ? createElement('img', { ...props, src: value, alt: alt || '', style: { maxWidth: '100%', ...props.style } }) : createElement('span', { className: 'missing-image' }, `Missing image: ${src || alt || ''}`);
    } },
    children: bodyMarkdown,
  }));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"/>
<style>
body{font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6;color:#111}
pre{background:#f6f6f6;padding:12px;border-radius:8px;overflow:auto}
code{font-family:ui-monospace,Consolas,monospace}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 10px}
@media print{body{margin:0;max-width:none}}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
${body}
<p><em>Exported from Dexter Write</em></p>
</body></html>`;
}

async function printMarkdown(title: string, source: string, project: ProjectRuntime, main: string): Promise<void> {
  const images: Record<string, string> = {};
  for (const asset of project.assets) images[asset.path] = await blobDataUrl(asset.blob);
  const frame = document.createElement('iframe');
  frame.title = 'Print document';
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0';
  const loaded = new Promise<void>((resolve) => { frame.onload = () => resolve(); });
  frame.srcdoc = buildStandaloneHtml(title, source, images, main);
  document.body.appendChild(frame);
  try {
    await loaded;
    const doc = frame.contentDocument!;
    await doc.fonts.ready;
    await Promise.all(Array.from(doc.images).map((image) => image.decode()));
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
  } finally { window.setTimeout(() => frame.remove(), 60000); }
}

export function resolveExportFilename(
  kind: ExportKind,
  docName?: string,
  stamp = new Date().toISOString().slice(0, 10),
): string {
  const stem = docName?.trim()
    ? docName.replace(/\.[^/.]+$/, '')
    : `document-${stamp}`;

  switch (kind) {
    case 'pdf':
    case 'typst-pdf':
      return `${stem}.pdf`;
    case 'tex':
      return `${stem}.tex`;
    case 'md':
      return `${stem}.md`;
    case 'txt':
      return `${stem}.txt`;
    case 'html':
      return `${stem}.html`;
    case 'typ':
      return `${stem}.typ`;
    case 'zip':
      return `dexter-write-project-${stamp}.zip`;
    default:
      return `${stem}.txt`;
  }
}

export async function doExport(kind: ExportKind, content: string, mode: DocMode, docName = 'main.md', project: ProjectRuntime = { files: [], assets: [], urls: {}, activeName: docName, revision: 0 }): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = resolveExportFilename(kind, docName, stamp);
  const stem = docName?.trim()
    ? docName.replace(/\.[^/.]+$/, '')
    : `document-${stamp}`;

  if (kind === 'pdf' && mode === 'typst') return doExport('typst-pdf', content, mode, docName, project);
  if (kind === 'pdf') {
    if (mode === 'latex') {
      {
        toast('Compiling PDF…', 'info', 3000);
        const res = await compileLatexProject(project, content, docName);
        if (res.pdf) {
          const blob = new Blob([new Uint8Array(res.pdf)], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          toast('PDF downloaded successfully!', 'success', 3000);
        } else {
          toast(`PDF compilation failed: ${res.error || 'Check log'}`, 'error', 6000);
        }
      }
      return;
    }
    // A dedicated printable document also works when the preview pane is hidden.
    await printMarkdown(stem, content, project, docName);
    return;
  }
  if (kind === 'tex') {
    downloadFile(filename, content, 'text/x-tex;charset=utf-8');
    return;
  }
  if (kind === 'md') {
    downloadFile(filename, content, 'text/markdown;charset=utf-8');
    return;
  }
  if (kind === 'txt') {
    downloadFile(filename, stripToPlainText(content, mode), 'text/plain;charset=utf-8');
    return;
  }
  if (kind === 'html') {
    if (mode !== 'markdown') throw new Error('Styled HTML export is available for Markdown. Use PDF or project ZIP for LaTeX and Typst.');
    const images: Record<string, string> = {};
    for (const asset of project.assets) images[asset.path] = await blobDataUrl(asset.blob);
    downloadFile(filename, buildStandaloneHtml(stem, content, images, docName), 'text/html;charset=utf-8');
    return;
  }
  if (kind === 'typ') {
    downloadFile(filename, content, 'text/plain;charset=utf-8');
    return;
  }
  if (kind === 'typst-pdf') {
    {
      const res = await compileTypstProject(project, content, docName);
      if (res.pdf) {
        const blob = new Blob([new Uint8Array(res.pdf)], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } else {
        toast(`Typst PDF failed: ${res.error || res.diagnostics.join('\n') || 'unknown error'}`, 'error', 7000);
      }
    }
    return;
  }
  if (kind === 'zip') {
    // Handled by exportProjectZip; kept here for exhaustiveness.
    return;
  }
}

export async function exportProjectZip(files: ProjectFile[], project?: ProjectRuntime): Promise<void> {
  const entries = files.map((f) => ({ name: f.name, data: f.content as string | Uint8Array }));
  if (entries.some((e) => e.name === '.dexter/project.json')) throw new Error('The .dexter/project.json path is reserved for project backups.');
  for (const asset of project?.assets ?? []) entries.push({ name: asset.path, data: new Uint8Array(await asset.blob.arrayBuffer()) });
  entries.push({ name: '.dexter/project.json', data: JSON.stringify({ version: 1, activeName: project?.activeName ?? files[0]?.name }) });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadZip(
    `dexter-write-project-${stamp}.zip`,
    entries,
  );
}
