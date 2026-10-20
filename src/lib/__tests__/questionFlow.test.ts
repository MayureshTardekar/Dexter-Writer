import { describe, expect, it } from 'vitest';
import {
  answerQuestion,
  beginQuestionFlow,
  buildQuestionMessage,
  cancelQuestion,
  findRetryRequest,
  isWaitingForAnswer,
  retryTurnFor,
} from '../agent/questionFlow';

const QUESTIONS = [
  { question: 'What dates did you attend State University?', reason: 'The template has no dates.' },
  { question: 'What is your graduation date?' },
];

describe('resumable question flow', () => {
  it('requires a task and at least one concrete question', () => {
    expect(beginQuestionFlow('', QUESTIONS)).toBeNull();
    expect(beginQuestionFlow('Update my resume', [])).toBeNull();
    expect(beginQuestionFlow('Update my resume', [{ question: '   ' }])).toBeNull();
  });

  it('deduplicates questions and keeps the original task', () => {
    const flow = beginQuestionFlow('Tailor my resume to the job description', [
      ...QUESTIONS,
      { question: 'WHAT IS YOUR GRADUATION DATE?' },
    ]);
    expect(flow).not.toBeNull();
    expect(flow?.originalTask).toBe('Tailor my resume to the job description');
    expect(flow?.questions).toHaveLength(2);
    expect(isWaitingForAnswer(flow)).toBe(true);
    expect(buildQuestionMessage(flow!)).toContain('graduation date');
    expect(buildQuestionMessage(flow!)).toContain('Tailor my resume');
  });

  it('builds a resume prompt that carries the original task and supplied answer', () => {
    const flow = beginQuestionFlow('Rewrite my resume for a backend role', QUESTIONS)!;
    const result = answerQuestion(flow, 'BSc Computer Science, May 2025')!;

    expect(result.flow.status).toBe('answered');
    expect(result.prompt).toContain('Original task:');
    expect(result.prompt).toContain('Rewrite my resume for a backend role');
    expect(result.prompt).toContain('What dates did you attend State University?');
    expect(result.prompt).toContain('BSc Computer Science, May 2025');
    expect(result.prompt).toMatch(/do not invent/i);
    expect(isWaitingForAnswer(result.flow)).toBe(false);
  });

  it('preserves earlier answers when a follow-up question pauses the resumed task', () => {
    const first = beginQuestionFlow('Use the Jake template for my resume', [
      { question: 'What is your full name?' },
    ])!;
    const answered = answerQuestion(first, 'Priya Raman')!;
    const followUp = beginQuestionFlow(
      answered.flow.originalTask,
      [{ question: 'Which university did you attend?' }],
      answered.flow,
    )!;

    expect(followUp.answers).toEqual([{ question: 'What is your full name?', answer: 'Priya Raman' }]);
    const resumed = answerQuestion(followUp, 'Pune University')!;
    expect(resumed.prompt).toContain('Priya Raman');
    expect(resumed.prompt).toContain('Pune University');
  });

  it('retains the constructed resume prompt and accumulated answers for Retry', () => {
    const flow = beginQuestionFlow('Tailor my Jake resume for a backend role', [
      { question: 'What is your full name?' },
      { question: 'Which university did you attend?' },
    ])!;
    const answered = answerQuestion(flow, 'Priya Raman, Pune University')!;
    const retry = retryTurnFor(answered);

    expect(retry.prompt).toBe(answered.prompt);
    expect(retry.prompt).toContain('Tailor my Jake resume for a backend role');
    expect(retry.prompt).toContain('Priya Raman, Pune University');
    expect(retry.flow.originalTask).toBe('Tailor my Jake resume for a backend role');
    expect(retry.flow.answers).toHaveLength(2);

    const secondPause = beginQuestionFlow(
      retry.flow.originalTask,
      [{ question: 'What is your graduation date?' }],
      retry.flow,
    )!;
    expect(secondPause.answers).toEqual(retry.flow.answers);
    expect(answerQuestion(secondPause, 'May 2026')!.prompt).toContain('Priya Raman, Pune University');
  });

  it('finds the user turn and retry context that Regenerate must resend', () => {
    const flow = beginQuestionFlow('Update my resume', [{ question: 'Which university?' }])!;
    const retry = retryTurnFor(answerQuestion(flow, 'Pune University')!);
    const request = findRetryRequest([
      { role: 'user', text: 'Update my resume' },
      { role: 'assistant', text: 'Which university?' },
      { role: 'user', text: 'Pune University', retry },
      { role: 'assistant', text: 'Provider failed.' },
    ]);

    expect(request?.index).toBe(2);
    expect(request?.displayText).toBe('Pune University');
    expect(request?.retry?.prompt).toContain('Original task:');
    expect(request?.retry?.prompt).toContain('Pune University');
    expect(request?.retry?.flow.originalTask).toBe('Update my resume');
  });

  it('cancellation stops the flow so an answer cannot resume work', () => {
    const flow = beginQuestionFlow('Fill in the missing template details', QUESTIONS)!;
    const cancelled = cancelQuestion(flow);

    expect(cancelled.status).toBe('cancelled');
    expect(isWaitingForAnswer(cancelled)).toBe(false);
    expect(answerQuestion(cancelled, 'some answer')).toBeNull();
  });

  it('rejects an empty answer', () => {
    const flow = beginQuestionFlow('Edit my resume', QUESTIONS)!;
    expect(answerQuestion(flow, '   ')).toBeNull();
  });
});
