import { describe, it, expect } from 'vitest';
import {
  endpointFor,
  finalizeToolCalls,
  parseToolArgs,
  toOpenAiMessages,
  toOpenAiTools,
} from '../agent/providers/openaiCompat';
import { sanitizeSchemaForGemini, toGeminiContents, toGeminiTools } from '../agent/providers/gemini';
import { toAnthropicMessages, toAnthropicTools } from '../agent/providers/anthropic';
import { providerKind, resolveConnection } from '../agent/providers/registry';
import type { AgentMessage, ToolDef } from '../agent/types';

/**
 * These guard the single most important invariant of the agent engine: a tool
 * result must travel back to the model as a real tool message tied to its
 * call, not as prose in a user turn. See AI_AGENT_ROADMAP.md §2 (P1), §5.
 */

const TRACE: AgentMessage[] = [
  { role: 'system', content: 'SYS' },
  { role: 'user', content: 'add a skills section' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'call_1', name: 'read_document_content', args: { start_line: 1, end_line: 5 } }],
  },
  { role: 'tool', toolCallId: 'call_1', name: 'read_document_content', content: '1: # CV' },
  { role: 'assistant', content: 'Done.' },
];

const TOOLS: ToolDef[] = [
  { name: 'edit_document', description: 'edit', kind: 'doc', parameters: { type: 'object', properties: { old_string: { type: 'string' } }, required: ['old_string'] } },
];

describe('OpenAI-compatible wire format', () => {
  it('maps a tool result to role:tool with tool_call_id', () => {
    const wire = toOpenAiMessages(TRACE);
    const toolMsg = wire.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.tool_call_id).toBe('call_1');
    expect(toolMsg?.content).toContain('# CV');
    // The regression we are protecting against: results smuggled in as prose.
    expect(wire.some((m) => m.role === 'user' && /Tool execution results/i.test(String(m.content)))).toBe(false);
  });

  it('serializes tool_calls with stringified arguments and null content', () => {
    const wire = toOpenAiMessages(TRACE);
    const assistant = wire.find((m) => m.tool_calls);
    expect(assistant?.content).toBeNull();
    expect(assistant?.tool_calls?.[0].id).toBe('call_1');
    expect(assistant?.tool_calls?.[0].type).toBe('function');
    expect(typeof assistant?.tool_calls?.[0].function.arguments).toBe('string');
    expect(JSON.parse(assistant?.tool_calls?.[0].function.arguments ?? '{}')).toEqual({ start_line: 1, end_line: 5 });
  });

  it('keeps the tool message immediately after its assistant message', () => {
    const wire = toOpenAiMessages(TRACE);
    const ai = wire.findIndex((m) => m.tool_calls);
    expect(wire[ai + 1].role).toBe('tool');
  });

  it('wraps tool defs in the function envelope', () => {
    const [def] = toOpenAiTools(TOOLS);
    expect(def.type).toBe('function');
    expect(def.function.name).toBe('edit_document');
  });

  it('reassembles tool calls from fragmented streaming deltas', () => {
    // `arguments` always arrives in pieces; only valid JSON once concatenated.
    const acc = new Map([
      [0, { id: 'call_a', name: 'edit_document', args: '{"old_string":"a' }],
      [1, { id: '', name: 'search_document', args: '{"pattern":"x"}' }],
    ]);
    acc.get(0)!.args += 'bc"}';
    const calls = finalizeToolCalls(acc);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ id: 'call_a', name: 'edit_document', args: { old_string: 'abc' } });
    // A missing provider id falls back to a synthesized one.
    expect(calls[1].id).toBe('call_1');
  });

  it('drops accumulator slots that never received a name', () => {
    expect(finalizeToolCalls(new Map([[0, { id: 'x', name: '', args: '{}' }]]))).toEqual([]);
  });

  it('never throws on malformed tool arguments', () => {
    expect(parseToolArgs('{"a":')).toEqual({});
    expect(parseToolArgs('')).toEqual({});
    expect(parseToolArgs('"a string"')).toEqual({});
  });

  it('builds the chat completions endpoint and tolerates a trailing slash', () => {
    expect(endpointFor('https://api.groq.com/openai/v1')).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(endpointFor('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions');
  });
});

describe('Gemini wire format', () => {
  it('sends tool results as a user functionResponse with an OBJECT response', () => {
    const contents = toGeminiContents(TRACE);
    const fr = contents.flatMap((c) => c.parts).find((p) => p.functionResponse);
    expect(fr?.functionResponse?.name).toBe('read_document_content');
    // A bare string here is rejected by the API.
    expect(typeof fr?.functionResponse?.response).toBe('object');
    expect(fr?.functionResponse?.response.output).toContain('# CV');
  });

  it('omits system messages (they go in system_instruction) and uses model role', () => {
    const contents = toGeminiContents(TRACE);
    expect(contents.every((c) => c.role === 'user' || c.role === 'model')).toBe(true);
    expect(contents.some((c) => c.parts.some((p) => p.text === 'SYS'))).toBe(false);
    expect(contents.find((c) => c.parts.some((p) => p.functionCall))?.role).toBe('model');
  });

  it('merges consecutive tool results into one content, in call order', () => {
    const msgs: AgentMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'a', name: 'read_document_content', args: {} },
        { id: 'b', name: 'get_document_outline', args: {} },
      ] },
      { role: 'tool', toolCallId: 'a', name: 'read_document_content', content: 'A' },
      { role: 'tool', toolCallId: 'b', name: 'get_document_outline', content: 'B' },
    ];
    const contents = toGeminiContents(msgs);
    const responses = contents.filter((c) => c.parts.every((p) => p.functionResponse));
    expect(responses).toHaveLength(1);
    expect(responses[0].parts.map((p) => p.functionResponse?.name)).toEqual([
      'read_document_content', 'get_document_outline',
    ]);
  });

  it('never emits an empty content block', () => {
    const contents = toGeminiContents([{ role: 'assistant', content: '' }]);
    expect(contents).toEqual([]);
  });

  it('strips JSON Schema keywords Gemini rejects', () => {
    const cleaned = sanitizeSchemaForGemini({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'n', default: 'x' },
        tags: { type: 'array', items: { type: 'string', pattern: '^a' } },
      },
      required: ['name'],
    });
    expect(cleaned.$schema).toBeUndefined();
    expect(cleaned.additionalProperties).toBeUndefined();
    const props = cleaned.properties as Record<string, Record<string, unknown>>;
    expect(props.name.default).toBeUndefined();
    expect(props.name.description).toBe('n');
    expect((props.tags.items as Record<string, unknown>).pattern).toBeUndefined();
    expect(cleaned.required).toEqual(['name']);
  });

  it('drops required entries that name unknown properties', () => {
    const cleaned = sanitizeSchemaForGemini({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a', 'ghost'],
    });
    expect(cleaned.required).toEqual(['a']);
  });

  it('omits parameters entirely for a tool with no properties', () => {
    const [{ functionDeclarations }] = toGeminiTools([
      { name: 'get_document_outline', description: 'o', kind: 'read', parameters: { type: 'object', properties: {} } },
    ]);
    expect(functionDeclarations[0]).not.toHaveProperty('parameters');
  });

  it('keeps parameters for a tool that has them', () => {
    const [{ functionDeclarations }] = toGeminiTools(TOOLS);
    expect(functionDeclarations[0]).toHaveProperty('parameters');
  });

  it('returns no tools array when there are no tools', () => {
    expect(toGeminiTools([])).toEqual([]);
  });
});

describe('Anthropic wire format', () => {
  it('sends tool results as tool_result blocks in a user message', () => {
    const wire = toAnthropicMessages(TRACE);
    const userBlocks = wire.filter((m) => m.role === 'user' && Array.isArray(m.content));
    const block = userBlocks.flatMap((m) => m.content as unknown as Array<Record<string, unknown>>)[0];
    expect(block.type).toBe('tool_result');
    expect(block.tool_use_id).toBe('call_1');
  });

  it('never emits an empty text block alongside tool_use', () => {
    const wire = toAnthropicMessages(TRACE);
    const assistant = wire.find((m) => m.role === 'assistant');
    const blocks = assistant?.content as unknown as Array<Record<string, unknown>>;
    expect(blocks.some((b) => b.type === 'text')).toBe(false);
    expect(blocks[0].type).toBe('tool_use');
  });

  it('substitutes placeholder content for an empty tool result', () => {
    const wire = toAnthropicMessages([{ role: 'tool', toolCallId: 'z', name: 'n', content: '' }]);
    const block = (wire[0].content as unknown as Array<Record<string, unknown>>)[0];
    expect(block.content).toBe('(no output)');
  });

  it('flags errored results with is_error', () => {
    const wire = toAnthropicMessages([{ role: 'tool', toolCallId: 'z', name: 'n', content: 'boom', isError: true }]);
    const block = (wire[0].content as unknown as Array<Record<string, unknown>>)[0];
    expect(block.is_error).toBe(true);
  });

  it('uses input_schema for tool defs', () => {
    expect(toAnthropicTools(TOOLS)[0]).toHaveProperty('input_schema');
  });
});

describe('provider routing', () => {
  it('routes every baseUrl provider through the OpenAI-compatible transport', () => {
    for (const id of ['openai', 'groq', 'openrouter', 'nvidia', 'ollama']) {
      expect(providerKind(id)).toBe('openai');
    }
    expect(providerKind('gemini')).toBe('gemini');
    expect(providerKind('anthropic')).toBe('anthropic');
  });

  it('falls back to provider defaults for blank model and baseUrl', () => {
    const conn = resolveConnection('groq', { apiKey: 'k', baseUrl: '  ', model: '' });
    expect(conn.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(conn.model).toBe('llama-3.3-70b-versatile');
    expect(conn.apiKey).toBe('k');
  });

  it('never sends a key to Ollama', () => {
    expect(resolveConnection('ollama', { apiKey: 'secret', baseUrl: '', model: '' }).apiKey).toBe('');
  });

  it('falls back to the default provider for an unknown id', () => {
    expect(resolveConnection('nope', { apiKey: '', baseUrl: '', model: '' }).kind).toBe('gemini');
  });
});
