import { PAUSE_TOOL_NAME, type MissingInfoQuestion, type ToolCall, type ToolDef } from '../types';
import type { ToolOutcome } from './document';

/**
 * Ask the user for facts the model must not invent. This is intentionally a
 * "pause" tool: the loop stops after it runs, so no later tool call can edit
 * the document before the user answers.
 */

export const INPUT_TOOL_NAMES = new Set([PAUSE_TOOL_NAME]);

export const INPUT_TOOL_DEFS: ToolDef[] = [
  {
    name: PAUSE_TOOL_NAME,
    description:
      'Ask the user for missing personal facts before editing. Use this instead of guessing an employer, job title, date, degree, metric, award, contact detail, or identity. It pauses the turn; after calling it, do not edit. Ask at most 5 focused questions.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          description: 'Focused questions whose answers are required before the original task can continue.',
          items: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'One concrete question, e.g. "What dates did you attend State University?"',
              },
              reason: {
                type: 'string',
                description: 'Optional short reason this fact is needed.',
              },
            },
            required: ['question'],
          },
        },
      },
      required: ['questions'],
    },
    kind: 'read',
  },
];

function normalizeQuestions(raw: unknown): MissingInfoQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: MissingInfoQuestion[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const source = typeof item === 'string' ? { question: item } : item;
    if (!source || typeof source !== 'object') continue;
    const record = source as Record<string, unknown>;
    const question = String(record.question ?? '').trim();
    if (!question) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const reason = String(record.reason ?? '').trim();
    out.push(reason ? { question, reason } : { question });
    if (out.length === 5) break;
  }

  return out;
}

export function executeInputTool(call: ToolCall): ToolOutcome {
  const questions = normalizeQuestions(call.args?.questions);
  if (questions.length === 0) {
    return {
      content: 'request_user_input failed: provide between 1 and 5 non-empty questions. Ask only for facts you cannot safely infer.',
      isError: true,
    };
  }

  const list = questions
    .map((q, i) => `${i + 1}. ${q.question}${q.reason ? ` (${q.reason})` : ''}`)
    .join('\n');

  return {
    content: `Waiting for the user to answer:\n${list}\nThe turn is paused. Do not edit until the user answers.`,
    badge: `Asked for ${questions.length} missing detail${questions.length === 1 ? '' : 's'}`,
    pause: true,
    questions,
  };
}
