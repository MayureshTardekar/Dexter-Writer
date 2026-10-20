import type { ProjectFile } from './projectFiles';
import { describeFactWarnings } from './agent/factSafety';
import { resolveProjectPath } from './projectPaths';

export interface ValidationIssue { file: string; message: string; severity: 'warning' | 'error' }
export function documentReferences(content: string): string[] {
  const refs: string[] = [];
  for (const pattern of [ /!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g, /<img\b[^>]*\bsrc=["']([^"']+)["']/gi, /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g, /\bimage\(\s*"([^"]+)"/g, /\\(?:input|include|bibliography)\{([^}]+)\}/g, /\b(?:include|import)\s+"([^"]+)"/g ]) {
    for (const m of content.matchAll(pattern)) refs.push(m[1]);
  }
  return [...new Set(refs)];
}
export function validateProject(files: Pick<ProjectFile, 'name' | 'content' | 'mode'>[], assetPaths: string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [], known = new Set([...files.map((f) => f.name), ...assetPaths]);
  for (const file of files) {
    for (const message of describeFactWarnings(file.content)) issues.push({ file: file.name, message, severity: 'warning' });
    for (const ref of documentReferences(file.content)) {
      if (/^(?:https?:|data:|blob:|#)/i.test(ref)) continue;
      try {
        const path = resolveProjectPath(file.name, decodeURI(ref));
        if (![path, ...['.tex', '.bib', '.png', '.jpg', '.jpeg', '.pdf'].map((ext) => path + ext)].some((p) => known.has(p))) issues.push({ file: file.name, message: `Missing project file: ${ref}`, severity: 'error' });
      } catch { issues.push({ file: file.name, message: `Invalid project reference: ${ref}`, severity: 'error' }); }
    }
    if (file.mode === 'markdown' && (file.content.match(/^\s*```/gm)?.length ?? 0) % 2) issues.push({ file: file.name, message: 'Unclosed fenced code block.', severity: 'error' });
    if (file.mode === 'latex') {
      const text = file.content.replace(/(?<!\\)%[^\n]*/g, '');
      const stack: string[] = [];
      for (const m of text.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
        if (m[1] === 'begin') stack.push(m[2]);
        else if (stack.pop() !== m[2]) issues.push({ file: file.name, message: `Unmatched environment: ${m[2]}`, severity: 'error' });
      }
      if (stack.length) issues.push({ file: file.name, message: `Unclosed environments: ${stack.join(', ')}`, severity: 'error' });
    }
  }
  return issues;
}
