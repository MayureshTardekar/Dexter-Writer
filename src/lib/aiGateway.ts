import { VIRTUAL_MCP_TOOL_DEFS } from './virtualMcp';
import { extractLatexMacros } from './latexParser';

export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'ollama';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  needsKey: boolean;
  keyName: string;
  help: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-2.0-flash', needsKey: true, keyName: 'gemini', help: 'Google AI Studio key (AIza…).' },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini', needsKey: true, keyName: 'openai', help: 'sk-… key. Direct browser call.' },
  { id: 'anthropic', label: 'Anthropic Claude', defaultModel: 'claude-3-5-sonnet-latest', needsKey: true, keyName: 'anthropic', help: 'sk-ant-… key. Note: browsers may hit CORS; use Ollama if blocked.' },
  { id: 'ollama', label: 'Ollama (local)', defaultModel: 'llama3.1', needsKey: false, keyName: 'ollama-base', help: 'Local endpoint, e.g. http://localhost:11434/v1. Run with OLLAMA_ORIGINS=*' },
];

export interface LlmToolCall {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

export interface LlmTurn {
  text: string;
  toolCalls: LlmToolCall[];
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  text: string;
}

/** Extra (external MCP) tool definitions merged into every provider call. */
export interface ExtraToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

function openAiTools(extra: ExtraToolDef[] = []): Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> {
  const base: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> = VIRTUAL_MCP_TOOL_DEFS.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  for (const t of extra) base.push({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } });
  return base;
}

function anthropicTools(extra: ExtraToolDef[] = []): Array<{ name: string; description: string; input_schema: unknown }> {
  const base: Array<{ name: string; description: string; input_schema: unknown }> = VIRTUAL_MCP_TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  for (const t of extra) base.push({ name: t.name, description: t.description, input_schema: t.parameters });
  return base;
}

function geminiTools(extra: ExtraToolDef[] = []) {
  return [
    {
      functionDeclarations: [
        ...VIRTUAL_MCP_TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters as unknown })),
        ...extra.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters as unknown })),
      ],
    },
  ];
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  history: ChatHistoryItem[],
  userText: string,
  extra: ExtraToolDef[] = [],
): Promise<LlmTurn> {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: system },
    ...history.map((h) => ({ role: h.role, content: h.text })),
    { role: 'user', content: userText },
  ];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, messages, tools: openAiTools(extra), tool_choice: 'auto', temperature: 0.4 }),
  });
  if (!res.ok) throw new Error(`OpenAI-compatible error ${res.status}: ${await res.text()}`.slice(0, 500));
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  const toolCalls: LlmToolCall[] = (msg.tool_calls ?? []).map((tc: { function: { name: string; arguments: string }; id: string }, i: number) => ({
    name: tc.function?.name ?? '',
    args: safeJsonParse(tc.function?.arguments ?? '{}'),
    id: tc.id ?? `call-${i}`,
  }));
  return { text: typeof msg.content === 'string' ? msg.content : '', toolCalls };
}

async function callAnthropic(apiKey: string, model: string, system: string, history: ChatHistoryItem[], userText: string, extra: ExtraToolDef[] = []): Promise<LlmTurn> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system,
      messages: [...history.map((h) => ({ role: h.role, content: h.text })), { role: 'user', content: userText }],
      tools: anthropicTools(extra),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`.slice(0, 500));
  const data = await res.json();
  const text = (data.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n');
  const toolCalls: LlmToolCall[] = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'tool_use')
    .map((b: { name: string; input: Record<string, unknown>; id: string }) => ({ name: b.name, args: b.input ?? {}, id: b.id }));
  return { text: text ?? '', toolCalls };
}

async function callGemini(apiKey: string, model: string, system: string, history: ChatHistoryItem[], userText: string, extra: ExtraToolDef[] = []): Promise<LlmTurn> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const contents = [
    ...history.map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: userText }] },
  ];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents, tools: geminiTools(extra) }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`.slice(0, 500));
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p: { text?: string }) => p.text).map((p: { text: string }) => p.text).join('\n');
  const toolCalls: LlmToolCall[] = parts
    .filter((p: { functionCall?: { name: string; args: Record<string, unknown> } }) => p.functionCall)
    .map((p: { functionCall: { name: string; args: Record<string, unknown> } }, i: number) => ({ name: p.functionCall.name, args: p.functionCall.args ?? {}, id: `gemini-${i}` }));
  return { text: text ?? '', toolCalls };
}

/**
 * Detect user-defined LaTeX macros (\newcommand, \renewcommand, \def) in the
 * document so the prompt can tell the model to REUSE them — instead of
 * hardcoding template macros (e.g. Jake's \resumeItem) that may not exist,
 * which would break compilation. Returns names WITHOUT the backslash.
 */
export function detectDocMacros(content: string, docMode: string): string[] {
  if (docMode !== 'latex' || !content) return [];
  try {
    const { macros } = extractLatexMacros(content);
    return [...macros.keys()].slice(0, 20);
  } catch {
    return [];
  }
}

export function buildSystemPrompt(
  docMode: string,
  outlineText: string,
  docExcerpt: string,
  externalHint = '',
  fileName = '',
  extraContext = '',
): string {
  const targetDesc = fileName ? `the user's active file "${fileName}" (${docMode} format)` : `the user's active ${docMode} document`;
  const modeRules =
    docMode === 'latex'
      ? `- LaTeX hygiene (non-negotiable): braces must balance — every { must close; NEVER put enumitem options like [nosep,leftmargin=*] or spacing commands (\\vspace, \\hspace) into body text; reuse the document's existing macros and environments; keep \\\\ line breaks clean (never \\\\4pt); math stays inside $...$ or $$...$$.`
      : docMode === 'typst'
        ? `- Typst hygiene: = / == headings, $...$ math, - list items; NEVER invent #directives or functions; reuse what the document already uses.`
        : `- Markdown hygiene: keep headings (#), GFM tables, and $...$ / $$...$$ math valid; never break fenced code blocks.`;
  return `You are Dexter Write, an AI document editor with direct MCP tools over ${targetDesc}. Work like a careful IDE assistant, not a chatbot.
Workflow (follow strictly):
1. If the user asks a QUESTION, answer it in chat first. Only call tools when they asked for an edit.
2. READ BEFORE YOU WRITE: before any insert/replace, call read_document_content on the exact line range you plan to change (or get_document_outline first for large docs). Never assume what is in the file.
3. Be SURGICAL: prefer one replace_lines over the smallest range that covers the change. Use insert_content only for genuinely new blocks. NEVER re-insert the preamble (\\documentclass, #set page, imports) and NEVER duplicate a section that already exists — update it in place.
4. One coherent edit per turn; batch related hunks instead of many tiny calls.
5. RESUME & WRITING EXCELLENCE: If editing or writing resume bullets, use Google's X-Y-Z formula (Accomplished [X] measured by [Y] by doing [Z]). Start each bullet with a strong action verb (Engineered, Architected, Shipped, Automated, Optimized). Never produce generic, passive filler.
${modeRules}
${extraContext ? `${extraContext}\n` : ''}${externalHint ? `- External MCP tools are available (prefixed mcp_). Use them to fetch live data (repos, search, citations), then write results into the document with the document tools.\n${externalHint}` : '- No external MCP servers connected.'}
- If no tool is needed, answer concisely in chat.
- After tools, summarize what changed with line numbers.
Document outline:\n${outlineText || '(empty)'}\n\nDocument excerpt (may be truncated):\n${docExcerpt.slice(0, 6000)}`;
}

export async function callLlm(
  provider: ProviderId,
  opts: { apiKey: string; baseUrl: string; model: string },
  system: string,
  history: ChatHistoryItem[],
  userText: string,
  extra: ExtraToolDef[] = [],
): Promise<LlmTurn> {
  const fallbackModel = PROVIDERS.find((p) => p.id === provider)?.defaultModel ?? 'gemini-2.0-flash';
  const model = opts.model.trim() || fallbackModel;
  if (provider === 'openai') return callOpenAiCompatible('https://api.openai.com/v1', opts.apiKey, model, system, history, userText, extra);
  if (provider === 'ollama') return callOpenAiCompatible(opts.baseUrl || 'http://localhost:11434/v1', '', model, system, history, userText, extra);
  if (provider === 'anthropic') return callAnthropic(opts.apiKey, model, system, history, userText, extra);
  return callGemini(opts.apiKey, model, system, history, userText, extra);
}
