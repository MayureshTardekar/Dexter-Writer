import { callLlm, type ProviderId } from './aiGateway';
import type { DocMode } from './templates';

export type AuditPreset = 'resume' | 'academic' | 'techdoc' | 'general';
export type IssueSeverity = 'critical' | 'warning' | 'suggestion';

export interface AuditIssue {
  id: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  startLine: number;
  endLine: number;
  originalText: string;
  proposedText: string;
  applied?: boolean;
}

export interface AuditReport {
  score: number; // 0 - 100
  summary: string;
  strengths: string[];
  issues: AuditIssue[];
}

export const AUDIT_PRESETS: Array<{ id: AuditPreset; label: string; desc: string }> = [
  {
    id: 'resume',
    label: 'ATS Resume Review',
    desc: 'Action verbs, quantifiable metric density, formatting, and keyword impact',
  },
  {
    id: 'academic',
    label: 'Academic Paper & Math Audit',
    desc: 'LaTeX formula validity, balance of braces, citations, and scholarly tone',
  },
  {
    id: 'techdoc',
    label: 'Technical Documentation Quality',
    desc: 'Code snippets, API completeness, broken links, clarity, and readability',
  },
  {
    id: 'general',
    label: 'Clarity, Grammar & Tone',
    desc: 'General polish, conciseness, typos, and sentence structure',
  },
];

function buildAuditPrompt(mode: DocMode, preset: AuditPreset, customGoal?: string): string {
  let criteria = '';
  if (preset === 'resume') {
    criteria = `
- Check that experience bullets start with strong past-tense action verbs (e.g. Architected, Accelerated, Reduced).
- Ensure statements include quantifiable metrics/impact (%, $, hours, scale).
- Check for ATS friendliness: avoid multi-column tables and non-standard symbols.
- Identify weak passive phrasing (e.g. "Responsible for", "Worked on") and propose punchy rewrites.`;
  } else if (preset === 'academic') {
    criteria = `
- Check LaTeX / Typst mathematical formulas for balanced delimiters ($...$, $$...$$, \\begin{align}, etc.).
- Ensure citations are properly formatted (\\cite{...} or [@key]) with academic tone.
- Verify abstract, methodology, and conclusion flow logically.
- Detect passive voice overload and suggest clearer scholarly phrasing.`;
  } else if (preset === 'techdoc') {
    criteria = `
- Ensure all code blocks specify a language identifier (e.g. \`\`\`ts, \`\`\`bash).
- Verify parameter tables, endpoints, and quickstarts are complete and clear.
- Identify ambiguous technical jargon or missing prerequisites.`;
  } else {
    criteria = `
- Audit grammar, spelling, typography, sentence flow, and clarity.
- Flag redundant or verbose sentences and offer concise alternatives.`;
  }

  if (customGoal) {
    criteria += `\n- User specified custom priority: "${customGoal}"`;
  }

  return `You are Dexter Write's Autonomous Document Review Agent.
Analyze the following ${mode.toUpperCase()} document thoroughly.

Review Criteria:${criteria}

Output Requirement:
Return ONLY a valid JSON object without surrounding commentary or markdown tags (or inside a single \`\`\`json block) adhering to this schema:
{
  "score": <number between 0 and 100 representing overall quality>,
  "summary": "<2-3 sentence executive evaluation of the document>",
  "strengths": ["<strength 1>", "<strength 2>", ...],
  "issues": [
    {
      "id": "iss-1",
      "title": "<short issue title>",
      "description": "<why this should be improved>",
      "severity": "critical" | "warning" | "suggestion",
      "startLine": <1-indexed start line number in document>,
      "endLine": <1-indexed end line number in document>,
      "originalText": "<exact text currently in the document at those lines>",
      "proposedText": "<exact improved replacement text>"
    }
  ]
}

Important:
- Provide exact startLine and endLine based on the numbered lines provided.
- Provide actionable proposedText so the user or agent can auto-apply the fix.`;
}

function cleanJson(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```json')) {
    s = s.slice(7);
  } else if (s.startsWith('```')) {
    s = s.slice(3);
  }
  if (s.endsWith('```')) {
    s = s.slice(0, -3);
  }
  return s.trim();
}

export async function runDocumentAudit(
  provider: ProviderId,
  credentials: { apiKey: string; baseUrl: string; model: string },
  content: string,
  mode: DocMode,
  preset: AuditPreset = 'resume',
  customGoal?: string,
): Promise<AuditReport> {
  const lines = content.split('\n');
  const numberedDoc = lines.map((l, i) => `${i + 1}: ${l}`).join('\n');
  const system = buildAuditPrompt(mode, preset, customGoal);

  const turn = await callLlm(
    provider,
    credentials,
    system,
    [],
    `Document to review (${lines.length} lines):\n\n${numberedDoc.slice(0, 15000)}`,
  );

  const jsonStr = cleanJson(turn.text);
  let parsed: Partial<AuditReport>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('Failed to parse AI review output as structured JSON. Try running the audit again.');
  }

  const issues: AuditIssue[] = (parsed.issues ?? []).map((it, idx) => ({
    id: it.id || `issue-${idx + 1}`,
    title: it.title || 'Formatting Improvement',
    description: it.description || 'Improvement suggested by review agent',
    severity: it.severity === 'critical' || it.severity === 'warning' ? it.severity : 'suggestion',
    startLine: Math.max(1, Math.min(lines.length, Number(it.startLine) || 1)),
    endLine: Math.max(1, Math.min(lines.length, Number(it.endLine) || 1)),
    originalText: String(it.originalText ?? ''),
    proposedText: String(it.proposedText ?? ''),
    applied: false,
  }));

  return {
    score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 75))),
    summary: parsed.summary || 'Document audit completed with automated recommendations.',
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5) : [],
    issues,
  };
}
