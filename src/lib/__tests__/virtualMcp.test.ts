import { describe, it, expect } from 'vitest';
import {
  readDocumentContent,
  insertContent,
  replaceLines,
  executeVirtualTool,
  validateDocEdit,
} from '../virtualMcp';

describe('Virtual MCP Document Server', () => {
  const sampleDoc = [
    '# Dexter Write Architecture',
    '',
    '## Introduction',
    'Dexter Write is a client-first collaborative document platform.',
    'It supports Markdown, LaTeX, and Typst.',
    '',
    '## Features',
    '- BYOK Vault',
    '- Virtual MCP Server',
    '- Real-Time Preview',
  ].join('\n');

  describe('readDocumentContent', () => {
    it('reads the entire document when no line range is provided', () => {
      const result = readDocumentContent(sampleDoc);
      expect(result).toBe(sampleDoc);
    });

    it('reads a specific sub-range of lines correctly (1-indexed)', () => {
      const result = readDocumentContent(sampleDoc, 3, 5);
      const lines = result.split('\n');
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe('## Introduction');
      expect(lines[2]).toBe('It supports Markdown, LaTeX, and Typst.');
    });

    it('clamps line bounds if start or end line exceeds boundaries', () => {
      const result = readDocumentContent(sampleDoc, -5, 999);
      expect(result).toBe(sampleDoc);
    });
  });

  describe('replaceLines', () => {
    it('replaces a single line', () => {
      const res = replaceLines(sampleDoc, 1, 1, '# Dexter Write 2.0');
      expect(res.ok).toBe(true);
      expect(res.newContent?.startsWith('# Dexter Write 2.0\n')).toBe(true);
    });

    it('replaces a multi-line range with new text', () => {
      const res = replaceLines(sampleDoc, 8, 10, '- All features bundled');
      expect(res.ok).toBe(true);
      expect(res.newContent).toContain('## Features\n- All features bundled');
      expect(res.newContent).not.toContain('- BYOK Vault');
    });

    it('successfully writes new text when replacing in an empty document', () => {
      const res = replaceLines('', 1, 1, 'Hello');
      expect(res.ok).toBe(true);
      expect(res.newContent).toBe('Hello');
    });
  });

  describe('insertContent', () => {
    it('inserts text after a target line', () => {
      const res = insertContent(sampleDoc, 3, 'after', 'A new subtitle');
      expect(res.ok).toBe(true);
      const lines = res.newContent?.split('\n') || [];
      expect(lines[3]).toBe('A new subtitle');
    });

    it('inserts text before line 1 (prepends)', () => {
      const res = insertContent(sampleDoc, 1, 'before', '--- title: Demo ---');
      expect(res.ok).toBe(true);
      expect(res.newContent?.startsWith('--- title: Demo ---\n# Dexter Write')).toBe(true);
    });
  });

  describe('executeVirtualTool', () => {
    it('executes read_document_content tool', () => {
      const toolRes = executeVirtualTool(sampleDoc, 'markdown', {
        name: 'read_document_content',
        args: { start_line: 1, end_line: 1 },
      });
      expect(toolRes.ok).toBe(true);
      expect(toolRes.resultText).toBe('# Dexter Write Architecture');
    });

    it('executes replace_lines tool and returns updated content', () => {
      const toolRes = executeVirtualTool(sampleDoc, 'markdown', {
        name: 'replace_lines',
        args: { start_line: 1, end_line: 1, replacement_text: '# Updated Heading' },
      });
      expect(toolRes.ok).toBe(true);
      expect(toolRes.newContent?.startsWith('# Updated Heading')).toBe(true);
    });

    it('executes get_document_outline tool on markdown', () => {
      const toolRes = executeVirtualTool(sampleDoc, 'markdown', {
        name: 'get_document_outline',
        args: {},
      });
      expect(toolRes.ok).toBe(true);
      expect(toolRes.resultText).toContain('Dexter Write Architecture');
      expect(toolRes.resultText).toContain('Introduction');
      expect(toolRes.resultText).toContain('Features');
    });
  });

  describe('validateDocEdit (pre-apply guard)', () => {
    const doc = 'one\ntwo\nthree\nfour\nfive';
    it('accepts sane ranges', () => {
      expect(validateDocEdit(doc, { name: 'replace_lines', args: { start_line: 2, end_line: 3, new_text: 'x' } })).toBeNull();
      expect(validateDocEdit(doc, { name: 'insert_content', args: { target_line: 6, position: 'after', text: 'x' } })).toBeNull();
    });
    it('rejects inverted, zero-based, and past-EOF ranges', () => {
      expect(validateDocEdit(doc, { name: 'replace_lines', args: { start_line: 4, end_line: 2, new_text: 'x' } })).toMatch(/after end_line/i);
      expect(validateDocEdit(doc, { name: 'replace_lines', args: { start_line: 0, end_line: 2, new_text: 'x' } })).toMatch(/start at 1/i);
      expect(validateDocEdit(doc, { name: 'replace_lines', args: { start_line: 99, end_line: 100, new_text: 'x' } })).toMatch(/past the end/i);
    });
    it('rejects bad insert targets and empty text', () => {
      expect(validateDocEdit(doc, { name: 'insert_content', args: { target_line: 99, position: 'after', text: 'x' } })).toMatch(/out of bounds/i);
      expect(validateDocEdit(doc, { name: 'insert_content', args: { target_line: 2, position: 'after', text: '   ' } })).toMatch(/empty text/i);
      expect(validateDocEdit(doc, { name: 'insert_content', args: { position: 'after', text: 'x' } })).toMatch(/integer target_line/i);
    });
    it('allows whole writes into empty documents', () => {
      expect(validateDocEdit('', { name: 'replace_lines', args: { start_line: 1, end_line: 1, new_text: 'x' } })).toBeNull();
      expect(validateDocEdit('', { name: 'insert_content', args: { target_line: 1, position: 'after', text: 'x' } })).toBeNull();
    });
    it('ignores non-edit tools', () => {
      expect(validateDocEdit(doc, { name: 'read_document_content', args: {} })).toBeNull();
    });
  });
});
