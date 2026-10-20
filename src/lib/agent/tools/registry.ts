import type { FileAccess, ToolCall, ToolDef, ToolResult } from '../types';
import type { DocMode } from '../../templates';
import { DOCUMENT_TOOL_DEFS, DOCUMENT_TOOL_NAMES, executeDocumentTool } from './document';
import { FILE_TOOL_DEFS, FILE_TOOL_NAMES, executeFileTool } from './files';
import { INPUT_TOOL_DEFS, INPUT_TOOL_NAMES, executeInputTool } from './input';
import { TEMPLATE_TOOL_DEFS, executeTemplateTool } from './templates';
import { validateProject } from '../../validateProject';

/**
 * Unified tool registry: merges the document tools, the project file tools and
 * any connected external MCP tools into one namespace, and dispatches calls to
 * the right executor.
 *
 * The registry is deliberately stateless about document content — it reads via
 * `ctx.getContent()` so the caller can point it at staged (uncommitted) state
 * during a multi-edit turn, and returns `newContent` for the caller to stage.
 * That keeps the unified workspace review in `AiPlayground` intact.
 */

export interface ToolContext {
  /** Current active-document content. Point this at staged state mid-turn. */
  getContent: () => string;
  mode: DocMode;
  getMode?: () => DocMode;
  assetPaths?: string[];
  /** Omit to disable the cross-file tools. */
  files?: FileAccess;
  /** External MCP tool defs, already `mcp_`-prefixed by externalMcp.ts. */
  external?: ToolDef[];
  /** Invokes an external MCP tool, including any permission prompt. */
  callExternal?: (name: string, args: Record<string, unknown>) => Promise<string>;
}

/** Convert `enabledExternalDefs()` output into engine tool defs. */
export function externalToToolDefs(
  defs: Array<{ defName: string; description?: string; parameters?: Record<string, unknown> }>,
): ToolDef[] {
  return defs.map((d) => ({
    name: d.defName,
    description: d.description || `External MCP tool ${d.defName}.`,
    parameters: d.parameters ?? { type: 'object', properties: {} },
    kind: 'external' as const,
  }));
}

export function buildToolDefs(ctx: ToolContext): ToolDef[] {
  const defs: ToolDef[] = [...DOCUMENT_TOOL_DEFS, ...INPUT_TOOL_DEFS];
  defs.push({ name: 'validate_document', kind: 'read', description: 'Check the active staged document for unfinished facts, missing assets/includes and simple syntax errors. This is not a PDF compilation.', parameters: { type: 'object', properties: {} } });
  if (ctx.files) defs.push(...FILE_TOOL_DEFS, ...TEMPLATE_TOOL_DEFS);
  if (ctx.external && ctx.external.length > 0) defs.push(...ctx.external);
  return defs;
}

export async function executeTool(ctx: ToolContext, call: ToolCall): Promise<ToolResult> {
  const base = { toolCallId: call.id, name: call.name };

  if (call.name === 'validate_document') {
    const name = ctx.files?.activeName() || 'main.md';
    const files = ctx.files?.list().map((f) => ({ name: f.name, mode: f.mode as DocMode, content: ctx.files!.read(f.name) || '' })) || [{ name, mode: ctx.getMode?.() ?? ctx.mode, content: ctx.getContent() }];
    const issues = validateProject(files, ctx.assetPaths || []);
    return { ...base, content: issues.length ? issues.map((i) => `${i.file}: ${i.severity}: ${i.message}`).join('\n') : 'Reference and syntax checks passed. PDF has not been compiled.' };
  }

  if (ctx.files && TEMPLATE_TOOL_DEFS.some((t) => t.name === call.name)) {
    return { ...base, ...executeTemplateTool(ctx.files, call) };
  }

  if (INPUT_TOOL_NAMES.has(call.name)) {
    return { ...base, ...executeInputTool(call) };
  }

  if (DOCUMENT_TOOL_NAMES.has(call.name)) {
    return { ...base, ...executeDocumentTool(ctx.getContent(), ctx.getMode?.() ?? ctx.mode, call) };
  }

  if (FILE_TOOL_NAMES.has(call.name)) {
    if (!ctx.files) {
      return { ...base, content: 'Project file tools are not available in this session. Work with the active document instead.', isError: true };
    }
    return { ...base, ...executeFileTool(ctx.files, call) };
  }

  const isExternal = ctx.external?.some((t) => t.name === call.name);
  if (isExternal && ctx.callExternal) {
    try {
      const text = await ctx.callExternal(call.name, call.args ?? {});
      return { ...base, content: text, badge: `🔌 ${call.name}` };
    } catch (e) {
      return {
        ...base,
        content: `External tool failed: ${e instanceof Error ? e.message : String(e)}`,
        isError: true,
      };
    }
  }

  const available = buildToolDefs(ctx).map((t) => t.name).join(', ');
  return {
    ...base,
    content: `Unknown tool "${call.name}". Available tools: ${available}. Call one of these, or answer the user in plain text.`,
    isError: true,
  };
}
