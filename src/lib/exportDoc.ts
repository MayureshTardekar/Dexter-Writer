import { stripToPlainText } from './docUtils';
import type { DocMode } from './templates';
import { compileLatexPdf } from './latexEngine';
import { compileTypstPdf } from './typstEngine';
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

export function buildStandaloneHtml(title: string, bodyMarkdown: string): string {
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
<pre>${escapeHtml(bodyMarkdown)}</pre>
<p><em>Exported from Dexter Write</em></p>
</body></html>`;
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

export function doExport(kind: ExportKind, content: string, mode: DocMode, docName?: string): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = resolveExportFilename(kind, docName, stamp);
  const stem = docName?.trim()
    ? docName.replace(/\.[^/.]+$/, '')
    : `document-${stamp}`;

  if (kind === 'pdf') {
    if (mode === 'latex') {
      void (async () => {
        toast('Compiling Overleaf-exact PDF…', 'info', 3000);
        const res = await compileLatexPdf(content);
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
      })();
      return;
    }
    // Print-styled engine: preview pane has print CSS, window.print() -> Save as PDF
    window.print();
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
    downloadFile(filename, buildStandaloneHtml(stem, content), 'text/html;charset=utf-8');
    return;
  }
  if (kind === 'typ') {
    downloadFile(filename, content, 'text/plain;charset=utf-8');
    return;
  }
  if (kind === 'typst-pdf') {
    void (async () => {
      const res = await compileTypstPdf(content);
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
    })();
    return;
  }
  if (kind === 'zip') {
    // Handled by exportProjectZip; kept here for exhaustiveness.
    return;
  }
}

export function exportProjectZip(files: ProjectFile[]): void {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadZip(
    `dexter-write-project-${stamp}.zip`,
    files.map((f) => ({ name: f.name, data: f.content })),
  );
}
