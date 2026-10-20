import { TEMPLATES, type StarterTemplate } from './templates';

const KEY = 'dexter-write:custom-templates:v1';
export function templateCatalog(): StarterTemplate[] {
  try {
    const custom: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    return [...TEMPLATES, ...(Array.isArray(custom) ? custom.filter((t): t is StarterTemplate => Boolean(t && typeof t.id === 'string' && t.id.startsWith('user-') && typeof t.content === 'string' && typeof t.label === 'string' && ['markdown', 'latex', 'typst'].includes(t.mode))) : [])];
  } catch { return [...TEMPLATES]; }
}
export function saveCustomTemplate(template: Omit<StarterTemplate, 'id'>): void {
  const custom = templateCatalog().filter((t) => t.id.startsWith('user-'));
  custom.push({ ...template, id: `user-${Date.now().toString(36)}` });
  localStorage.setItem(KEY, JSON.stringify(custom));
}
export function findTemplates(query: string): StarterTemplate[] {
  const catalog = templateCatalog();
  const q = query.toLowerCase().replace(/[’']/g, '').trim();
  const exact = catalog.find((t) => t.id.toLowerCase() === q || t.label.toLowerCase().replace(/[’']/g, '') === q);
  if (exact) return [exact];
  const words = q.split(/\s+/).filter((w) => !['template', 'templates', 'the', 'using'].includes(w));
  return catalog.filter((t) => words.every((w) => `${t.id} ${t.label} ${t.description}`.toLowerCase().replace(/[’']/g, '').includes(w)));
}
