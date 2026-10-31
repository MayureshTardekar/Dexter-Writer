import { describe, it, expect } from 'vitest';
import {
  BRIDGE_TOKEN_KEY,
  ensureBridgeToken,
  executeBridgeResource,
  executeBridgeTool,
  formatDiagnostics,
  formatOutline,
  formatProjectFiles,
  formatReadActive,
  parseBridgeRequest,
  type BridgeAccess,
  type BridgeDocument,
  type BridgeTokenStore,
} from '../mcp/bridgeClient';

const markdown: BridgeDocument = {
  name: 'main.md',
  mode: 'markdown',
  content: '# Title\nAlpha\n## Section\nBeta\nGamma',
};

function access(overrides: Partial<BridgeDocument> = {}): BridgeAccess {
  const doc = { ...markdown, ...overrides };
  return {
    active: () => doc,
    files: () => [
      { name: 'main.md', mode: 'markdown', lines: 5, active: true },
      { name: 'refs.tex', mode: 'latex', lines: 2, active: false },
    ],
  };
}

describe('MCP bridge formatting', () => {
  it('reads a numbered line range', () => {
    const text = formatReadActive(markdown, { start_line: 2, end_line: 4 });
    expect(text).toBe('main.md (markdown, lines 2-4 of 5)\n2 | Alpha\n3 | ## Section\n4 | Beta');
  });

  it('reads without line numbers when requested', () => {
    expect(formatReadActive(markdown, { include_line_numbers: false }))
      .toBe('main.md (markdown, 5 lines)\n# Title\nAlpha\n## Section\nBeta\nGamma');
  });

  it('clamps ranges beyond the document end', () => {
    expect(formatReadActive(markdown, { start_line: 99, end_line: 120 }))
      .toBe('main.md (markdown, lines 5-5 of 5)\n5 | Gamma');
  });

  it('formats the document outline with heading levels', () => {
    const text = formatOutline(markdown);
    expect(text).toContain('Outline of "main.md" (markdown, 2 headings)');
    expect(text).toContain('- Title (line 1)');
    expect(text).toContain('  - Section (line 3)');
  });

  it('handles documents without headings', () => {
    expect(formatOutline({ name: 'empty.md', mode: 'markdown', content: 'plain text' }))
      .toBe('Outline of "empty.md" (markdown, 0 headings)\nNo headings found.');
  });

  it('formats the project file list and marks the active file', () => {
    const text = formatProjectFiles(access().files());
    expect(text).toContain('Project files (2, active: main.md)');
    expect(text).toContain('- main.md [markdown, 5 lines] (active)');
    expect(text).toContain('- refs.tex [latex, 2 lines]');
  });

  it('dispatches each read-only tool', async () => {
    expect((await executeBridgeTool(access(), 'dexter_read_active_document', { start_line: 1, end_line: 1 }))
      .content[0].text).toContain('1 | # Title');
    expect((await executeBridgeTool(access(), 'dexter_get_outline')).content[0].text).toContain('Title');
    expect((await executeBridgeTool(access(), 'dexter_list_project_files')).content[0].text).toContain('refs.tex');
  });

  it('reads another project file and reports applied edits', async () => {
    const withWrites: BridgeAccess = {
      ...access(),
      readFile: (args) => (args.filename === 'refs.tex'
        ? { name: 'refs.tex', mode: 'latex', content: '@article{one,\n  title={One}\n}' }
        : null),
      stageEdit: (args) => ({
        ok: true,
        message: `staged ${String(args.new_string)}`,
        files: 2,
        file: 'refs.tex',
      }),
    };
    const read = await executeBridgeTool(withWrites, 'dexter_read_project_file', {
      filename: 'refs.tex',
      start_line: 2,
      end_line: 2,
    });
    expect(read.content[0].text).toContain('2 |   title={One}');

    const staged = await executeBridgeTool(withWrites, 'dexter_stage_edit', {
      old_string: 'One',
      new_string: 'Two',
    });
    expect(staged.isError).toBeUndefined();
    expect(staged.content[0].text).toContain('staged Two');
    expect(staged.content[0].text).toContain('2 files changed');

    const missing: BridgeAccess = { ...withWrites, readFile: () => null };
    expect((await executeBridgeTool(missing, 'dexter_read_project_file', { filename: 'nope.md' })).isError)
      .toBe(true);
  });

  it('dispatches insert and compile outcomes', async () => {
    const withWrites: BridgeAccess = {
      ...access(),
      insertContent: (args) => ({
        ok: true,
        message: `inserted at ${String(args.target_line)}`,
        files: 1,
      }),
      compile: async (args) => ({
        ok: false,
        file: 'main.md',
        mode: 'markdown',
        message: `${String(args.format ?? 'pdf')} check found an issue`,
        diagnostics: ['[error] Missing project file: fig.png'],
      }),
    };
    const inserted = await executeBridgeTool(withWrites, 'dexter_insert_content', {
      target_line: 2,
      content: 'Beta',
    });
    expect(inserted.content[0].text).toContain('inserted at 2');
    expect(inserted.content[0].text).toContain('1 file changed');

    const compiled = await executeBridgeTool(withWrites, 'dexter_compile_document', { format: 'preview' });
    expect(compiled.isError).toBe(true);
    expect(compiled.content[0].text).toContain('preview check found an issue');
  });

  it('formats diagnostics and routes them through resources', async () => {
    const outcome = {
      issues: [
        { file: 'main.tex', message: 'Missing project file: fig.png', severity: 'error' as const },
      ],
      compile: {
        ok: false,
        file: 'main.tex',
        mode: 'latex' as const,
        message: 'main.tex failed to compile: undefined control sequence',
        diagnostics: ['Overfull \\hbox'],
        pages: undefined,
        compileMs: 1240,
      },
    };
    const text = formatDiagnostics(outcome);
    expect(text).toContain('[error] main.tex: Missing project file: fig.png');
    expect(text).toContain('Last compile: main.tex failed (1240ms)');
    expect(text).toContain('Overfull \\hbox');

    const withDiagnostics: BridgeAccess = { ...access(), diagnostics: () => outcome };
    const resource = await executeBridgeResource(withDiagnostics, 'dexter://compiler/diagnostics');
    expect(resource.content[0].text).toContain('Missing project file');
    expect((await executeBridgeResource(withDiagnostics, 'dexter://document/outline')).content[0].text)
      .toContain('Title');
  });

  it('returns a tool-level error for unknown tools', async () => {
    const result = await executeBridgeTool(access(), 'dexter_write_files');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown Dexter Write tool');
  });
});

describe('MCP bridge parsing and pairing', () => {
  it('parses valid tool and resource requests', () => {
    const request = parseBridgeRequest(JSON.stringify({
      id: 'r1',
      method: 'tool_call',
      params: { name: 'dexter_get_outline', arguments: {} },
    }));
    expect(request?.method).toBe('tool_call');
    if (request?.method === 'tool_call') expect(request.params.name).toBe('dexter_get_outline');

    const resource = parseBridgeRequest(JSON.stringify({
      id: 'r2',
      method: 'resource_read',
      params: { uri: 'dexter://document/active' },
    }));
    expect(resource?.method).toBe('resource_read');
    if (resource?.method === 'resource_read') {
      expect(resource.params.uri).toBe('dexter://document/active');
    }
  });

  it('rejects malformed bridge messages', () => {
    expect(parseBridgeRequest('not json')).toBeNull();
    expect(parseBridgeRequest('null')).toBeNull();
    expect(parseBridgeRequest(JSON.stringify({ id: 1, method: 'tool_call', params: {} }))).toBeNull();
    expect(parseBridgeRequest(JSON.stringify({ id: 'r1', method: 'other', params: {} }))).toBeNull();
    expect(parseBridgeRequest(JSON.stringify({
      id: 'r1',
      method: 'tool_call',
      params: { name: 'dexter_get_outline', arguments: [] },
    }))).toBeNull();
    expect(parseBridgeRequest(JSON.stringify({
      id: 'r1',
      method: 'resource_read',
      params: {},
    }))).toBeNull();
  });

  it('reuses a browser pairing token across starts', () => {
    const values = new Map<string, string>();
    const store: BridgeTokenStore = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    };
    const first = ensureBridgeToken(store);
    const second = ensureBridgeToken(store);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(16);
    expect(values.get(BRIDGE_TOKEN_KEY)).toBe(first);
  });
});
