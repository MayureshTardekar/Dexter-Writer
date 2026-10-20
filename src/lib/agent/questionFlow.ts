import type { MissingInfoQuestion } from './types';
import type { ActiveWorkspaceTarget } from '../aiWorkspace';

/**
 * Resumable missing-information flow.
 *
 * The model's questions and the user's answers are kept together with the
 * ORIGINAL task. When the user answers, the caller sends `prompt` as the next
 * user turn, so the model continues the task instead of starting over or
 * treating the answer as a brand-new request.
 */

export interface QuestionAnswer {
  question: string;
  answer: string;
}

export type QuestionStatus = 'asking' | 'answered' | 'cancelled';

export interface QuestionFlow {
  status: QuestionStatus;
  originalTask: string;
  questions: MissingInfoQuestion[];
  answers: QuestionAnswer[];
}

export interface AnswerResult {
  flow: QuestionFlow;
  /** The complete user turn to send to the agent. */
  prompt: string;
}

/** Metadata stored on the user turn so Retry reuses the resumed request. */
export interface RetryTurn {
  /** The complete user turn that was sent to the agent. */
  prompt: string;
  /** The answered flow at the point this turn was sent. */
  flow: QuestionFlow;
  target?: ActiveWorkspaceTarget;
}

function cleanQuestions(questions: MissingInfoQuestion[]): MissingInfoQuestion[] {
  const out: MissingInfoQuestion[] = [];
  const seen = new Set<string>();
  for (const q of questions) {
    const question = String(q?.question ?? '').trim();
    if (!question) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = String(q.reason ?? '').trim();
    out.push(reason ? { question, reason } : { question });
    if (out.length === 5) break;
  }
  return out;
}

export function beginQuestionFlow(
  originalTask: string,
  questions: MissingInfoQuestion[],
  previous?: QuestionFlow | null,
): QuestionFlow | null {
  const task = originalTask.trim();
  const cleaned = cleanQuestions(questions);
  if (!task || cleaned.length === 0) return null;

  return {
    status: 'asking',
    originalTask: task,
    questions: cleaned,
    answers: previous?.answers ? previous.answers.map((a) => ({ ...a })) : [],
  };
}

export function buildQuestionMessage(flow: QuestionFlow): string {
  const lines = flow.questions.map((q, i) => {
    const reason = q.reason ? `\n   _${q.reason}_` : '';
    return `${i + 1}. **${q.question}**${reason}`;
  });
  const task = flow.originalTask.length > 180 ? `${flow.originalTask.slice(0, 180)}…` : flow.originalTask;
  return [
    'I need a few details before I edit, so I do not invent them:',
    '',
    ...lines,
    '',
    `Answer in the box below. I will then continue the original task: “${task}”.`,
  ].join('\n');
}

function mergeAnswers(existing: QuestionAnswer[], questions: MissingInfoQuestion[], answer: string): QuestionAnswer[] {
  const next = existing.map((a) => ({ ...a }));
  for (const q of questions) {
    const entry = { question: q.question, answer };
    const index = next.findIndex((a) => a.question === q.question);
    if (index >= 0) next[index] = entry;
    else next.push(entry);
  }
  return next;
}

/**
 * Record one user answer against every question in the current flow and build
 * the resume turn. Returns null for an empty answer so callers cannot resume
 * with an empty user message.
 */
export function answerQuestion(flow: QuestionFlow, answer: string): AnswerResult | null {
  const text = answer.trim();
  if (!text || flow.status !== 'asking' || flow.questions.length === 0) return null;

  const updated: QuestionFlow = {
    ...flow,
    status: 'answered',
    answers: mergeAnswers(flow.answers, flow.questions, text),
  };

  const supplied = updated.answers
    .map((a, i) => `${i + 1}. Q: ${a.question}\n   A: ${a.answer}`)
    .join('\n');

  const prompt = [
    '[Resuming the original task after the user supplied missing details]',
    '',
    'Original task:',
    updated.originalTask,
    '',
    'User-supplied facts:',
    supplied || '(the user answered in the conversation above)',
    '',
    'Continue the original task from where it paused. Use only the supplied facts; do not invent any other personal details, and do not restart or re-ask these questions unless an answer is ambiguous.',
    'If the user says they do not know or asks you to proceed anyway, use a visible [[NEEDS INPUT: short description]] placeholder for that fact instead of guessing.',
  ].join('\n');

  return { flow: updated, prompt };
}

/**
 * Build the retry metadata for a resumed turn. Keeping both the constructed
 * prompt and the answered flow means Retry does not resend only the user's
 * short answer, and a second pause still knows the original task.
 */
export function retryTurnFor(result: AnswerResult): RetryTurn {
  return { prompt: result.prompt, flow: result.flow };
}

export interface RetryMessage {
  role: 'user' | 'assistant';
  text: string;
  retry?: RetryTurn;
}

export interface RetryRequest {
  /** Index of the user turn to replace. */
  index: number;
  /** The text shown in the transcript. */
  displayText: string;
  /** Full resumed turn, when the user turn answered a question. */
  retry?: RetryTurn;
}

/** Find the last user turn and the metadata needed to send it again. */
export function findRetryRequest(messages: RetryMessage[]): RetryRequest | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'user') continue;
    return { index: i, displayText: message.text, retry: message.retry };
  }
  return null;
}

export function cancelQuestion(flow: QuestionFlow): QuestionFlow {
  return { ...flow, status: 'cancelled' };
}

export function isWaitingForAnswer(flow: QuestionFlow | null): boolean {
  return flow?.status === 'asking';
}
