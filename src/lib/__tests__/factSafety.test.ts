import { describe, expect, it } from 'vitest';
import {
  describeFactWarnings,
  findMissingInputPlaceholders,
  findTemplateSampleFacts,
} from '../agent/factSafety';
import { TEMPLATES } from '../templates';

describe('fact safety warnings', () => {
  it('finds visible missing-information placeholders once each', () => {
    const doc = [
      '[[NEEDS INPUT: graduation date]]',
      '[[needs input: Graduation Date]]',
      '[[NEEDS INPUT: current employer]]',
    ].join('\n');

    expect(findMissingInputPlaceholders(doc)).toEqual(['graduation date', 'current employer']);
  });

  it('detects sample identities from the bundled resume templates', () => {
    const doc = [
      '# Alex Carter',
      'alex.carter@email.com | github.com/alexcarter',
      'Senior Software Engineer - Acme Cloud',
      'Software Engineer - Datawise',
      'Shipped an API serving 2M+ requests/day',
    ].join('\n');

    const found = findTemplateSampleFacts(doc);
    expect(found).toContain('Alex Carter');
    expect(found).toContain('Acme Cloud');
    expect(found).toContain('Datawise');
    expect(found).toContain('sample metric: 2M+ requests/day');
  });

  it('does not flag ordinary content or a user-owned company called Acme', () => {
    expect(findTemplateSampleFacts('Acme Corporation\nJordan Patel')).toEqual([]);
    expect(describeFactWarnings('Jordan Patel\nSoftware Engineer at Northstar')).toEqual([]);
  });

  it('reads Jake-template example fields from declared template metadata', () => {
    const jake = TEMPLATES.find((t) => t.id === 'resume-jake-tex');
    expect(jake?.exampleFields?.length).toBeGreaterThan(0);

    const found = findTemplateSampleFacts(jake!.content);
    expect(found).toContain('unfinished name "Your Name"');
    expect(found).toContain('unfinished email "your.email@example.com"');
    expect(found).toContain('unfinished LinkedIn URL "linkedin.com/in/yourusername"');
    expect(found).toContain('unfinished education dates "2022 -- 2026"');
    expect(found).toContain('unfinished project "Project Name"');
    expect(found).toContain('sample skills "Python, TypeScript, JavaScript, SQL, C++, Java"');
  });

  it('warns when a Jake resume is only partly filled in', () => {
    const jake = TEMPLATES.find((t) => t.id === 'resume-jake-tex')!.content;
    const partial = jake
      .replace('Your Name', 'Priya Raman')
      .replace('+1 (555) 123-4567', '+91 98765 43210')
      .replace('your.email@example.com', 'priya@example.com')
      .replace('linkedin.com/in/yourusername', 'linkedin.com/in/priyaraman')
      .replace('github.com/yourusername', 'github.com/priyaraman')
      .replace('University Name', 'Pune University')
      .replace('College Name', 'Fergusson College')
      .replace('Degree / Field of Study', 'B.Tech Computer Science')
      .replace('Relevant Degree / Honors', 'Higher Secondary');

    const warnings = describeFactWarnings(partial);
    expect(warnings[0]).toMatch(/template sample/i);
    expect(warnings[0]).toContain('unfinished project "Project Name"');
    expect(warnings[0]).toContain('unfinished education dates "2022 -- 2026"');
    expect(warnings[0]).toContain('sample skills "Python, TypeScript, JavaScript, SQL, C++, Java"');
    expect(warnings[0]).not.toContain('Your Name');
  });

  it('reports both sample content and placeholders for review', () => {
    const warnings = describeFactWarnings('Alex Carter\n[[NEEDS INPUT: graduation date]]');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/template sample/i);
    expect(warnings[1]).toMatch(/placeholders/i);
  });
});
