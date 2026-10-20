import { templateCatalog, findTemplates } from '../../templateCatalog';
import { projectPath } from '../../projectPaths';
import { extForMode } from '../../projectFiles';
import type { FileAccess, ToolCall, ToolDef } from '../types';
import type { ToolOutcome } from './document';

export function renderTemplateCatalog(): string {
  return templateCatalog().map((t) => `- ${t.id}: ${t.label} (${t.mode}) — ${t.description}`).join('\n');
}
export const TEMPLATE_TOOL_DEFS: ToolDef[] = [
  { name: 'list_templates', kind: 'read', description: 'List available built-in and personal templates. Template content contains examples, not user facts.', parameters: { type: 'object', properties: {} } },
  { name: 'create_from_template', kind: 'file', description: 'Create a NEW staged document from a template id or unambiguous query. Makes it the agent active document; read it and replace example fields using only supplied facts. Never overwrites existing work.', parameters: { type: 'object', properties: { template: { type: 'string' }, name: { type: 'string', description: 'Optional new relative project filename with matching extension.' } }, required: ['template'] } },
];
export function executeTemplateTool(files: FileAccess, call: ToolCall): ToolOutcome {
  if (call.name === 'list_templates') return { content: renderTemplateCatalog() };
  const matches = findTemplates(String(call.args.template ?? ''));
  if (matches.length !== 1) return { isError: true, content: matches.length ? `Choose one template id: ${matches.map((t) => t.id).join(', ')}` : 'No matching template. Call list_templates.' };
  const t = matches[0];
  try {
    const name = projectPath(String(call.args.name || `${t.id}.${extForMode(t.mode)}`));
    if (!name.endsWith(`.${extForMode(t.mode)}`)) return { isError: true, content: `Use the .${extForMode(t.mode)} extension for this template.` };
    const final = files.create(name, t.mode, t.content);
    if (!final) throw new Error('Could not stage the template.');
    files.setActive?.(final);
    return { content: `Created staged ${final}; it is now your active document. Read it before editing. Replace these example fields, never claim them as user facts: ${(t.exampleFields ?? []).map((f) => f.label).join('; ')}. Ask for missing facts with request_user_input.`, badge: `Created ${t.label}` };
  } catch (e) { return { isError: true, content: String(e) }; }
}
