import type { DocMode } from './templates';
import { getTemplate } from './templates';

// Phase 2: multi-file project store (file tree + tabs).
// Migrates the Phase 1 single-document localStorage automatically.

export interface ProjectFile {
  id: string;
  name: string;
  mode: DocMode;
  content: string;
  updatedAt: number;
}

const LS_PROJECT = 'dexter-write:project:v1';
const LS_ACTIVE = 'dexter-write:project:active';
const LS_LEGACY_DOC = 'dexter-write:doc';
const LS_LEGACY_MODE = 'dexter-write:mode';

export function modeForName(name: string): DocMode {
  const n = name.toLowerCase();
  if (n.endsWith('.tex')) return 'latex';
  if (n.endsWith('.typ')) return 'typst';
  return 'markdown';
}

export function extForMode(mode: DocMode): string {
  return mode === 'latex' ? 'tex' : mode === 'typst' ? 'typ' : 'md';
}

function uid(): string {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function newProjectFile(name: string, mode: DocMode, content = ''): ProjectFile {
  return { id: uid(), name, mode, content, updatedAt: Date.now() };
}

function defaults(): ProjectFile[] {
  const now = Date.now();
  return [
    { id: uid(), name: 'main.md', mode: 'markdown', content: getTemplate('api-md').content, updatedAt: now },
    { id: uid(), name: 'resume.typ', mode: 'typst', content: getTemplate('resume-typ').content, updatedAt: now },
    { id: uid(), name: 'paper.tex', mode: 'latex', content: getTemplate('paper-tex').content, updatedAt: now },
  ];
}

export function loadProject(): { files: ProjectFile[]; activeId: string } {
  try {
    const raw = localStorage.getItem(LS_PROJECT);
    if (raw) {
      const files = JSON.parse(raw) as ProjectFile[];
      if (Array.isArray(files) && files.length > 0) {
        const activeId = localStorage.getItem(LS_ACTIVE) || files[0].id;
        const ok = files.some((f) => f.id === activeId) ? activeId : files[0].id;
        return { files, activeId: ok };
      }
    }
  } catch { /* fall through */ }
  // Migrate Phase 1 single doc if present
  try {
    const legacy = localStorage.getItem(LS_LEGACY_DOC);
    if (legacy != null) {
      const mode = (localStorage.getItem(LS_LEGACY_MODE) as DocMode) || 'markdown';
      const f = newProjectFile(`main.${extForMode(mode)}`, mode, legacy);
      return { files: [f], activeId: f.id };
    }
  } catch { /* ignore */ }
  const files = defaults();
  return { files, activeId: files[0].id };
}

export function saveProject(files: ProjectFile[], activeId: string): void {
  try {
    localStorage.setItem(LS_PROJECT, JSON.stringify(files));
    localStorage.setItem(LS_ACTIVE, activeId);
  } catch { /* quota — ignore */ }
}

export function uniqueName(files: ProjectFile[], base: string): string {
  if (!files.some((f) => f.name === base)) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let i = 2;
  while (files.some((f) => f.name === `${stem}-${i}${ext}`)) i++;
  return `${stem}-${i}${ext}`;
}
