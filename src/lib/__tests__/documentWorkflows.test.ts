import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectPath, relativeProjectPath, resolveProjectPath } from '../projectPaths';
import { imageSnippet } from '../assets';
import { compilerCacheKey } from '../compilerFiles';
import { createZip } from '../zip';
import { readZip } from '../importProject';
import { validateProject } from '../validateProject';
import { createWorkspaceStager, findUndoConflicts, findWorkspaceConflicts } from '../aiWorkspace';
import { executeTool } from '../agent/tools/registry';
import { conversationContext } from '../agent/context';
import { buildStandaloneHtml } from '../exportDoc';
import { toOpenAiMessages } from '../agent/providers/openaiCompat';
import { toGeminiContents } from '../agent/providers/gemini';
import { toAnthropicMessages } from '../agent/providers/anthropic';
import type { AgentMessage, FileAccess } from '../agent/types';
import { saveProject } from '../projectFiles';

afterEach(() => vi.unstubAllGlobals());
describe('portable assets and imports', () => {
  it('resolves folders without allowing traversal out of the project', () => {
    expect(projectPath('assets/photo.png')).toBe('assets/photo.png');
    expect(relativeProjectPath('docs/paper.tex', 'assets/photo.png')).toBe('../assets/photo.png');
    expect(resolveProjectPath('docs/paper.tex', '../assets/photo.png')).toBe('assets/photo.png');
    for (const value of ['../private', '/etc/file', 'C:\\file', 'assets/../file', 'assets//file']) expect(() => projectPath(value)).toThrow();
    expect(() => resolveProjectPath('paper.tex', '../photo.png')).toThrow();
  });
  it('generates image syntax with safe captions and source-relative paths', () => {
    const options = { alt: 'A < B', caption: 'Speed: 30% & rising', width: 60, align: 'center' as const };
    expect(imageSnippet('markdown', 'docs/a.md', 'assets/a.png', options)).toContain('../assets/a.png');
    expect(imageSnippet('markdown', 'a.md', 'assets/a.png', options)).toContain('A &lt; B');
    expect(imageSnippet('latex', 'a.tex', 'assets/a.png', options)).toContain('30\\% \\& rising');
    expect(imageSnippet('typst', 'a.typ', 'assets/a.png', options)).toContain('width: 60%');
    expect(() => imageSnippet('latex', 'a.tex', 'assets/a%.png', options)).toThrow();
  });
  it('invalidates compile caches when equal-sized images or paths change', () => {
    const one = [{ path: 'assets/a.png', content: new Uint8Array([1, 2]) }];
    expect(compilerCacheKey('source', one)).not.toBe(compilerCacheKey('source', [{ ...one[0], content: new Uint8Array([1, 3]) }]));
    expect(compilerCacheKey('source', one)).not.toBe(compilerCacheKey('source', [{ ...one[0], path: 'assets/b.png' }]));
  });
  it('round-trips a ZIP with nested sources and binary images', async () => {
    const entries = [{ name: 'docs/main.md', data: '# Hello' }, { name: 'assets/a.png', data: new Uint8Array([0, 1, 255]) }];
    const parsed = await readZip(createZip(entries));
    expect(parsed.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    expect(parsed[1].data).toEqual(new Uint8Array([0, 1, 255]));
  });
  it('rejects ZIP traversal, duplicate entries and corrupt data', async () => {
    await expect(readZip(createZip([{ name: '../escape.txt', data: 'x' }]))).rejects.toThrow();
    await expect(readZip(createZip([{ name: 'x.txt', data: 'a' }, { name: 'x.txt', data: 'b' }]))).rejects.toThrow(/duplicate/i);
    const corrupt = createZip([{ name: 'x.txt', data: 'payload' }]); corrupt[35] ^= 1;
    await expect(readZip(corrupt)).rejects.toThrow(/checksum/i);
  });
  it('reports missing relative images, placeholders and unclosed syntax', () => {
    const files = [{ name: 'docs/main.md', mode: 'markdown' as const, content: '![test](../assets/a.png)\n[[NEEDS INPUT: name]]\n```ts\nhello' }];
    expect(validateProject(files, []).map((i) => i.message).join('\n')).toMatch(/Missing project file/);
    expect(validateProject(files, ['assets/a.png']).map((i) => i.message).join('\n')).not.toMatch(/Missing project file/);
    expect(validateProject(files, []).length).toBe(3);
  });
  it('exports rendered Markdown and embeds project images without scripts', () => {
    const html = buildStandaloneHtml('Report', '# Heading\n\n![alt](assets/a.png)\n\n<script>alert(1)</script>', { 'assets/a.png': 'data:image/png;base64,AAAA' });
    expect(html).toContain('<h1>Heading</h1>'); expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<pre># Heading');
  });
});
describe('template and recovery workflows', () => {
  it('creates Jake, switches the staged active document, then edits it without changing live files', async () => {
    const live = new Map([['main.md', '# Existing work']]);
    const base: FileAccess = { list: () => [{ name: 'main.md', mode: 'markdown', lines: 1, active: true }], read: (name) => live.get(name) ?? null, write: () => { throw new Error('Live writes forbidden'); }, create: () => { throw new Error('Live creates forbidden'); }, activeName: () => 'main.md', idOf: (name) => name === 'main.md' ? 'main' : null };
    const stager = createWorkspaceStager(base, null);
    const ctx = { files: stager.access, mode: 'latex' as const, getContent: () => stager.access.read(stager.access.activeName()) || '' };
    const create = await executeTool(ctx, { id: '1', name: 'create_from_template', args: { template: 'Jake', name: 'resume.tex' } });
    expect(create.isError).toBeFalsy(); expect(stager.access.activeName()).toBe('resume.tex');
    const edit = await executeTool(ctx, { id: '2', name: 'edit_document', args: { old_string: 'Your Name', new_string: 'Priya Raman' } });
    expect(edit.isError).toBeFalsy();
    stager.stageActive({ fileId: null, name: 'resume.tex', mode: 'latex', content: stager.access.read('resume.tex')! }, edit.newContent!, 'Filled name');
    expect(stager.workspace().changes).toHaveLength(1);
    expect(stager.workspace().changes[0].before).toBeNull();
    expect(stager.access.read('resume.tex')).toContain('Priya Raman');
    expect([...live]).toEqual([['main.md', '# Existing work']]);
  });
  it('blocks ambiguous template matching rather than choosing a format silently', async () => {
    const files: FileAccess = { list: () => [], read: () => null, write: () => false, create: () => { throw new Error('Must not create'); }, activeName: () => '' };
    const result = await executeTool({ files, mode: 'markdown', getContent: () => '' }, { id: '1', name: 'create_from_template', args: { template: 'resume' } });
    expect(result.isError).toBe(true); expect(result.content).toContain('Choose one');
  });
  it('blocks apply and undo after filename or format changes even if text is identical', () => {
    const target = { id: '1', name: 'main.md', mode: 'markdown' as const, content: 'before' };
    const workspace = { id: 'w', startedAt: 1, changes: [{ key: 'id:1', fileId: '1', name: 'main.md', mode: 'markdown' as const, before: 'before', after: 'after', labels: [] }] };
    expect(findWorkspaceConflicts(workspace, [{ ...target, name: 'renamed.md' }])).toHaveLength(1);
    expect(findWorkspaceConflicts(workspace, [{ ...target, mode: 'latex' }])).toHaveLength(1);
    expect(findUndoConflicts({ id: 'a', createdAt: 1, summary: 'created', files: [{ fileId: '1', name: 'main.md', mode: 'markdown', created: true, before: null, after: 'before' }] }, [{ ...target, name: 'renamed.md' }])).toHaveLength(1);
  });
  it('preserves long user facts whole and reports omissions when over budget', () => {
    const text = 'name and education '.repeat(200);
    expect(conversationContext([{ role: 'user', text: 'display', sourceText: text }]).history[0].content).toBe(text);
    const context = conversationContext([{ role: 'user', text }, { role: 'user', text: 'latest' }], 100);
    expect(context.history).toEqual([{ role: 'user', content: 'latest' }]); expect(context.notice).toMatch(/earlier/);
  });
  it('encodes authorized image references in all three provider protocols', () => {
    const messages: AgentMessage[] = [{ role: 'user', content: 'Use this reference', images: [{ name: 'a.png', mime: 'image/png', data: 'AAAA' }] }];
    expect(JSON.stringify(toOpenAiMessages(messages))).toContain('data:image/png;base64,AAAA');
    expect(JSON.stringify(toGeminiContents(messages))).toContain('inlineData');
    expect(JSON.stringify(toAnthropicMessages(messages))).toContain('media_type');
    expect(JSON.stringify(toOpenAiMessages([{ role: 'user', content: 'no consent' }]))).not.toContain('image_url');
  });
  it('reports project-save failures', () => {
    vi.stubGlobal('localStorage', { setItem() { throw new Error('Quota exceeded'); } });
    expect(saveProject([], '')).toEqual({ ok: false, error: 'Quota exceeded' });
  });
});
