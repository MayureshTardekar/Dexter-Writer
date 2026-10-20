/**
 * Deterministic checks for the two fact-safety failure modes the prompt alone
 * cannot guarantee:
 *
 *  1. Template example identities/achievements surviving into the user's doc.
 *  2. Missing facts left as `[[NEEDS INPUT: ...]]` placeholders.
 *
 * These are warnings, not auto-corrections. A user may legitimately share a
 * sample name, so the UI asks them to confirm rather than rewriting silently.
 * Template markers are declared next to the template content itself, so a new
 * template (e.g. Jake's Resume) does not require editing this scanner.
 */

import { TEMPLATES, type TemplateExampleField } from '../templates';

function collectTemplateExampleFields(): TemplateExampleField[] {
  const out: TemplateExampleField[] = [];
  const seen = new Set<string>();
  for (const template of TEMPLATES) {
    for (const field of template.exampleFields ?? []) {
      const key = field.match.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(field);
    }
  }
  return out;
}

const TEMPLATE_EXAMPLE_FIELDS = collectTemplateExampleFields();

const PLACEHOLDER_RE = /\[\[NEEDS INPUT:\s*([^\]\n]+?)\s*\]\]/gi;

export function findMissingInputPlaceholders(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(PLACEHOLDER_RE)) {
    const label = String(match[1] ?? '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export function findTemplateSampleFacts(content: string): string[] {
  const lower = content.toLowerCase();
  const out: string[] = [];
  for (const { label, match } of TEMPLATE_EXAMPLE_FIELDS) {
    if (lower.includes(match.toLowerCase())) out.push(label);
  }
  return out;
}

/** Human-readable warnings for the chat UI. Empty when the content is clean. */
export function describeFactWarnings(content: string): string[] {
  const warnings: string[] = [];

  const samples = findTemplateSampleFacts(content);
  if (samples.length > 0) {
    warnings.push(
      `Template sample or unfinished content retained (${samples.join(', ')}). Confirm it belongs to the user, or replace it with their facts / [[NEEDS INPUT: ...]].`,
    );
  }

  const missing = findMissingInputPlaceholders(content);
  if (missing.length > 0) {
    warnings.push(`Missing information left as placeholders: ${missing.join(', ')}.`);
  }

  return warnings;
}
