import { stripToPlainText } from './docUtils';
import type { DocMode } from './templates';
import { compileTypstPdf } from './typstEngine';
import { downloadZip } from './zip';
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

export function doExport(kind: ExportKind, content: string, mode: DocMode): void {
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === 'pdf') {
    // Print-styled engine: preview pane has print CSS, window.print() -> Save as PDF
    window.print();
    return;
  }
  if (kind === 'tex') {
    downloadFile(`dexter-write-${stamp}.tex`, content, 'text/x-tex;charset=utf-8');
    return;
  }
  if (kind === 'md') {
    downloadFile(`dexter-write-${stamp}.md`, content, 'text/markdown;charset=utf-8');
    return;
  }
  if (kind === 'txt') {
    downloadFile(`dexter-write-${stamp}.txt`, stripToPlainText(content, mode), 'text/plain;charset=utf-8');
    return;
  }
  if (kind === 'html') {
    downloadFile(`dexter-write-${stamp}.html`, buildStandaloneHtml('Dexter Write Export', content), 'text/html;charset=utf-8');
    return;
  }
  if (kind === 'typ') {
    downloadFile(`dexter-write-${stamp}.typ`, content, 'text/plain;charset=utf-8');
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
        a.download = `dexter-write-${stamp}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } else {
        alert(`Typst PDF failed: ${res.error || res.diagnostics.join('\n') || 'unknown error'}`);
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
