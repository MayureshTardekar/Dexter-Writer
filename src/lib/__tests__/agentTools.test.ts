import { describe, it, expect } from 'vitest';
import { executeDocumentTool, stripLineGutter, lineOfIndex, allIndexesOf } from '../agent/tools/document';
import { executeFileTool, renderFileList } from '../agent/tools/files';
import { buildToolDefs, executeTool, externalToToolDefs } from '../agent/tools/registry';
import type { FileAccess, ToolCall } from '../agent/types';

const DOC = [
  '# Resume',
  '',
  '## Experience',
  '- Built the thing at Acme',
  '- Built the thing at Globex',
  '',
  '## Education',
  'BSc',
].join('\n');

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: 'c1', name, args });

describe('edit_document — exact string replace', () => {
  it('replaces a unique match and reports the resulting line range', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('edit_document', {
      old_string: '- Built the thing at Acme',
      new_string: '- Shipped the thing at Acme',
    }));
    expect(r.isError).toBeFalsy();
    expect(r.newContent).toContain('- Shipped the thing at Acme');
    expect(r.newContent).toContain('- Built the thing at Globex');
    expect(r.content).toMatch(/lines 4-4/);
  });

  it('fails recoverably when old_string is absent', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('edit_document', {
      old_string: 'nonexistent text',
      new_string: 'x',
    }));
    expect(r.isError).toBe(true);
    expect(r.newContent).toBeUndefined();
    // The message must tell the model how to recover.
    expect(r.content).toMatch(/not found/i);
    expect(r.content).toMatch(/search_document|read_document_content/);
  });

  it('refuses an ambiguous match and names every matching line', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('edit_document', {
      old_string: '- Built the thing at',
      new_string: '- Shipped',
    }));
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/matched 2 times/);
    expect(r.content).toMatch(/lines 4, 5/);
    expect(r.content).toMatch(/replace_all/);
  });

  it('honours replace_all for a repeated string', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('edit_document', {
      old_string: '- Built',
      new_string: '- Shipped',
      replace_all: true,
    }));
    expect(r.isError).toBeFalsy();
    expect(r.newContent?.match(/- Shipped/g)).toHaveLength(2);
    expect(r.content).toMatch(/2 occurrence/);
  });

  it('deletes when new_string is empty', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('edit_document', {
      old_string: '\n- Built the thing at Globex',
      new_string: '',
    }));
    expect(r.isError).toBeFalsy();
    expect(r.newContent).not.toContain('Globex');
  });

  it('rejects an empty old_string, a no-op, and an empty document', () => {
    expect(executeDocumentTool(DOC, 'markdown', call('edit_document', { old_string: '', new_string: 'x' })).isError).toBe(true);
    expect(executeDocumentTool(DOC, 'markdown', call('edit_document', { old_string: 'BSc', new_string: 'BSc' })).isError).toBe(true);
    expect(executeDocumentTool('', 'markdown', call('edit_document', { old_string: 'a', new_string: 'b' })).isError).toBe(true);
  });

  it('tolerates a model that copies the prompt line-number gutter into arguments', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('edit_document', {
      old_string: '7│## Education',
      new_string: '7│## Studies',
    }));
    expect(r.isError).toBeFalsy();
    expect(r.newContent).toContain('## Studies');
    expect(r.newContent).not.toContain('7│');
  });
});

describe('stripLineGutter', () => {
  it('strips the gutter only when every non-empty line carries one', () => {
    expect(stripLineGutter('  1│a\n  2│b')).toBe('a\nb');
    // Mixed content is left alone — the pipe may be real document text.
    expect(stripLineGutter('1│a\nplain')).toBe('1│a\nplain');
    expect(stripLineGutter('no gutter here')).toBe('no gutter here');
  });
});

describe('search_document', () => {
  it('returns matching lines with line numbers', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('search_document', { pattern: 'Acme' }));
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/1 match/);
    expect(r.content).toMatch(/^4: - Built the thing at Acme$/m);
  });

  it('is case-insensitive by default and case-sensitive on request', () => {
    expect(executeDocumentTool(DOC, 'markdown', call('search_document', { pattern: 'acme' })).content).toMatch(/1 match/);
    expect(executeDocumentTool(DOC, 'markdown', call('search_document', { pattern: 'acme', case_sensitive: true })).content).toMatch(/No match/);
  });

  it('supports regex and caps results', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('search_document', { pattern: '^## ', is_regex: true }));
    expect(r.content).toMatch(/2 match/);
    const capped = executeDocumentTool(DOC, 'markdown', call('search_document', { pattern: '.', is_regex: true, max_results: 2 }));
    expect(capped.content).toMatch(/capped at 2/);
  });

  it('reports an invalid regex instead of throwing', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('search_document', { pattern: '([', is_regex: true }));
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/invalid regular expression/i);
  });

  it('treats a literal pattern literally', () => {
    expect(executeDocumentTool(DOC, 'markdown', call('search_document', { pattern: '([' })).content).toMatch(/No match/);
  });
});

describe('positional document tools', () => {
  it('numbers the lines it reads so the model can target them', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('read_document_content', { start_line: 3, end_line: 4 }));
    expect(r.content).toBe('3: ## Experience\n4: - Built the thing at Acme');
  });

  it('rejects an out-of-range replace instead of clamping silently', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('replace_lines', { start_line: 99, end_line: 100, new_text: 'x' }));
    expect(r.isError).toBe(true);
    expect(r.newContent).toBeUndefined();
    expect(r.content).toMatch(/REJECTED/);
  });

  it('warns that line numbers shift after an edit', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('insert_content', { target_line: 2, position: 'after', text: 'new' }));
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/shifted/);
  });

  it('extracts an outline with line numbers', () => {
    const r = executeDocumentTool(DOC, 'markdown', call('get_document_outline'));
    expect(r.content).toMatch(/Experience \(line 3\)/);
  });
});

describe('index helpers', () => {
  it('finds non-overlapping occurrences', () => {
    expect(allIndexesOf('aaaa', 'aa')).toEqual([0, 2]);
    expect(allIndexesOf('abc', 'z')).toEqual([]);
    expect(allIndexesOf('abc', '')).toEqual([]);
  });

  it('maps a character offset to a 1-indexed line', () => {
    expect(lineOfIndex('a\nb\nc', 0)).toBe(1);
    expect(lineOfIndex('a\nb\nc', 2)).toBe(2);
    expect(lineOfIndex('a\nb\nc', 4)).toBe(3);
  });
});

// ---------------------------------------------------------------------------

function fakeFiles(): FileAccess & { store: Map<string, string> } {
  const store = new Map<string, string>([
    ['main.md', '# Main\nbody'],
    ['paper.tex', '\\section{Intro}\nText'],
  ]);
  return {
    store,
    list: () => [...store.entries()].map(([name, content]) => ({
      name,
      mode: name.endsWith('.tex') ? 'latex' : 'markdown',
      lines: content.split('\n').length,
      active: name === 'main.md',
    })),
    read: (name) => store.get(name) ?? null,
    write: (name, content) => {
      if (!store.has(name)) return false;
      store.set(name, content);
      return true;
    },
    create: (name, _mode, content) => {
      store.set(name, content);
      return name;
    },
    activeName: () => 'main.md',
  };
}

describe('project file tools', () => {
  it('lists files and marks the active one', () => {
    const out = renderFileList(fakeFiles());
    expect(out).toMatch(/main\.md \(markdown, 2 lines\)\s+← ACTIVE FILE/);
    expect(out).toMatch(/paper\.tex \(latex, 2 lines\)/);
  });

  it('reads another file with line numbers', () => {
    const r = executeFileTool(fakeFiles(), call('read_file', { name: 'paper.tex' }));
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/1: \\section\{Intro\}/);
  });

  it('lists the valid names when a file is missing', () => {
    const r = executeFileTool(fakeFiles(), call('read_file', { name: 'ghost.md' }));
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/main\.md/);
  });

  it('rejects path traversal and nested names', () => {
    for (const name of ['../secrets', 'a/b.md', 'a\\b.md']) {
      expect(executeFileTool(fakeFiles(), call('read_file', { name })).isError).toBe(true);
    }
  });

  it('edits another file by exact string and does NOT stage it as a doc diff', () => {
    const files = fakeFiles();
    const r = executeFileTool(files, call('edit_file', {
      name: 'paper.tex',
      old_string: '\\section{Intro}',
      new_string: '\\section{Introduction}',
    }));
    expect(r.isError).toBeFalsy();
    expect(files.store.get('paper.tex')).toContain('Introduction');
    // newContent must be absent: this was not the active document.
    expect(r.newContent).toBeUndefined();
  });

  it('propagates an ambiguous match from edit_file', () => {
    const files = fakeFiles();
    files.store.set('paper.tex', 'dup\ndup');
    const r = executeFileTool(files, call('edit_file', { name: 'paper.tex', old_string: 'dup', new_string: 'x' }));
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/edit_file\("paper\.tex"\)/);
  });

  it('creates a file and infers the mode from the extension', () => {
    const files = fakeFiles();
    const r = executeFileTool(files, call('create_file', { name: 'cover.tex', content: 'hi' }));
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/latex/);
    expect(files.store.get('cover.tex')).toBe('hi');
  });

  it('refuses to edit the ACTIVE document and redirects to edit_document', () => {
    // Routing the active file through edit_file would bypass diff review and
    // be clobbered by a later edit_document in the same turn.
    const r = executeFileTool(fakeFiles(), call('edit_file', {
      name: 'main.md', old_string: '# Main', new_string: '# Home',
    }));
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/ACTIVE document/);
    expect(r.content).toMatch(/edit_document/);
  });

  it('tells the model the real name when create de-duplicates it', () => {
    const base = fakeFiles();
    const renaming = { ...base, create: () => 'main-2.md' };
    const r = executeFileTool(renaming, call('create_file', { name: 'main.md', content: 'x' }));
    expect(r.isError).toBeFalsy();
    expect(r.content).toMatch(/main-2\.md/);
    expect(r.content).toMatch(/renamed/i);
  });

  it('reports failure when create returns null', () => {
    const failing = { ...fakeFiles(), create: () => null };
    expect(executeFileTool(failing, call('create_file', { name: 'x.md', content: 'y' })).isError).toBe(true);
  });
});

describe('tool registry', () => {
  const ctx = { getContent: () => DOC, mode: 'markdown' as const };

  it('exposes file tools only when FileAccess is supplied', () => {
    expect(buildToolDefs(ctx).map((t) => t.name)).not.toContain('list_files');
    expect(buildToolDefs({ ...ctx, files: fakeFiles() }).map((t) => t.name)).toContain('list_files');
  });

  it('always exposes edit_document and search_document', () => {
    const names = buildToolDefs(ctx).map((t) => t.name);
    expect(names).toContain('edit_document');
    expect(names).toContain('search_document');
    expect(names).toContain('request_user_input');
  });

  it('returns a pause result with normalized questions', async () => {
    const r = await executeTool(ctx, call('request_user_input', {
      questions: [
        { question: '  What is your full name?  ', reason: 'The template uses a sample name.' },
        { question: 'What is your full name?' },
        { question: 'Which university did you attend?' },
      ],
    }));

    expect(r.isError).toBeFalsy();
    expect(r.pause).toBe(true);
    expect(r.newContent).toBeUndefined();
    expect(r.questions).toEqual([
      { question: 'What is your full name?', reason: 'The template uses a sample name.' },
      { question: 'Which university did you attend?' },
    ]);
    expect(r.badge).toMatch(/2 missing details/);
  });

  it('rejects an empty question list so the model can recover', async () => {
    const r = await executeTool(ctx, call('request_user_input', { questions: [] }));
    expect(r.isError).toBe(true);
    expect(r.pause).toBeFalsy();
    expect(r.content).toMatch(/1 and 5/i);
  });

  it('attaches the call id to every result', async () => {
    const r = await executeTool(ctx, { id: 'abc', name: 'get_document_outline', args: {} });
    expect(r.toolCallId).toBe('abc');
    expect(r.name).toBe('get_document_outline');
  });

  it('answers an unknown tool with the available list so the model can recover', async () => {
    const r = await executeTool(ctx, call('totally_made_up'));
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/edit_document/);
  });

  it('explains that file tools are unavailable rather than crashing', async () => {
    const r = await executeTool(ctx, call('list_files'));
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/not available/i);
  });

  it('routes external MCP calls and converts failures into recoverable results', async () => {
    const external = externalToToolDefs([{ defName: 'mcp_gh_search', description: 'search', parameters: { type: 'object', properties: {} } }]);
    const ok = await executeTool(
      { ...ctx, external, callExternal: async () => 'result text' },
      call('mcp_gh_search'),
    );
    expect(ok.content).toBe('result text');
    expect(ok.badge).toMatch(/mcp_gh_search/);

    const bad = await executeTool(
      { ...ctx, external, callExternal: async () => { throw new Error('denied'); } },
      call('mcp_gh_search'),
    );
    expect(bad.isError).toBe(true);
    expect(bad.content).toMatch(/denied/);
  });

  it('marks converted external defs as external and keeps a description', () => {
    const [def] = externalToToolDefs([{ defName: 'mcp_x_y' }]);
    expect(def.kind).toBe('external');
    expect(def.description).toBeTruthy();
    expect(def.parameters).toEqual({ type: 'object', properties: {} });
  });
});
