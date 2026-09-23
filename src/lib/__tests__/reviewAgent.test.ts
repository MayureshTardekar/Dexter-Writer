import { describe, it, expect } from 'vitest';
import { cleanJson, buildAuditPrompt, AUDIT_PRESETS } from '../reviewAgent';

describe('Autonomous Document Review Agent', () => {
  describe('Preset Configurations', () => {
    it('defines 4 standard review presets', () => {
      expect(AUDIT_PRESETS.length).toBe(4);
      const ids = AUDIT_PRESETS.map((p) => p.id);
      expect(ids).toContain('resume');
      expect(ids).toContain('academic');
      expect(ids).toContain('techdoc');
      expect(ids).toContain('general');
    });
  });

  describe('cleanJson', () => {
    it('cleans raw markdown-fenced json blocks', () => {
      const input = '```json\n{"score": 90, "summary": "Great doc"}\n```';
      const cleaned = cleanJson(input);
      expect(cleaned).toBe('{"score": 90, "summary": "Great doc"}');
    });

    it('cleans plain triple backtick blocks', () => {
      const input = '```\n{"score": 85}\n```';
      const cleaned = cleanJson(input);
      expect(cleaned).toBe('{"score": 85}');
    });

    it('handles already clean JSON strings', () => {
      const input = '{"score": 95}';
      const cleaned = cleanJson(input);
      expect(cleaned).toBe('{"score": 95}');
    });
  });

  describe('buildAuditPrompt', () => {
    it('includes ATS action verbs and metrics for resume preset', () => {
      const prompt = buildAuditPrompt('markdown', 'resume');
      expect(prompt).toContain('past-tense action verbs');
      expect(prompt).toContain('quantifiable metrics');
      expect(prompt).toContain('ATS friendliness');
    });

    it('includes mathematical delimiter and citation checks for academic preset', () => {
      const prompt = buildAuditPrompt('latex', 'academic');
      expect(prompt).toContain('LaTeX / Typst mathematical formulas');
      expect(prompt).toContain('citations');
    });

    it('includes code block language tags for techdoc preset', () => {
      const prompt = buildAuditPrompt('markdown', 'techdoc');
      expect(prompt).toContain('code blocks specify a language identifier');
    });

    it('appends custom user goals when provided', () => {
      const prompt = buildAuditPrompt('markdown', 'general', 'Focus strictly on clarity for beginner engineers');
      expect(prompt).toContain('Focus strictly on clarity for beginner engineers');
    });
  });

  describe('Batch Issue Fix Application Line Ordering', () => {
    it('sorts line replacements descending so earlier indices remain stable', () => {
      const issues = [
        { id: '1', startLine: 3, endLine: 3, originalText: 'old3', proposedText: 'new3' },
        { id: '2', startLine: 10, endLine: 10, originalText: 'old10', proposedText: 'new10' },
        { id: '3', startLine: 1, endLine: 1, originalText: 'old1', proposedText: 'new1' },
      ];

      // Sorting descending by startLine prevents modifying earlier lines from shifting line numbers of later lines
      const sorted = [...issues].sort((a, b) => b.startLine - a.startLine);
      expect(sorted.map((i) => i.startLine)).toEqual([10, 3, 1]);
    });
  });
});
