import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import {
  titleFor,
  saveConversation,
  loadConversations,
  deleteConversation,
  clearConversations,
  newConversationId,
  type ChatConversation,
} from '../chatHistory';

function convo(over: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: newConversationId(),
    title: 'x',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [{ role: 'user', text: 'hello' }],
    ...over,
  };
}

describe('chatHistory', () => {
  beforeEach(() => clearConversations());
  afterEach(() => vi.unstubAllGlobals());

  it('titles from the first user message', () => {
    expect(titleFor([{ role: 'assistant', text: 'hi' }, { role: 'user', text: '  write my resume please  ' }])).toBe('write my resume please');
    expect(titleFor([{ role: 'assistant', text: 'hi' }])).toBe('New conversation');
  });

  it('truncates long titles', () => {
    const t = titleFor([{ role: 'user', text: 'a'.repeat(100) }]);
    expect(t.length).toBeLessThanOrEqual(45);
    expect(t.endsWith('…')).toBe(true);
  });

  it('skips greeting-only conversations', () => {
    saveConversation(convo({ messages: [{ role: 'assistant', text: 'Hi!' }] }));
    expect(loadConversations().length).toBe(0);
  });

  it('round-trips a conversation and trims giant dumps', () => {
    const c = convo({ messages: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'x'.repeat(9000) }] });
    saveConversation(c);
    const all = loadConversations();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe(c.id);
    expect(all[0].messages[1].text.length).toBeLessThan(5000);
    expect(all[0].title).toBe('q');
  });

  it('round-trips the resumed-turn retry context', () => {
    const retry = {
      prompt: '[Resuming the original task]\nOriginal task:\nUpdate my resume\nA: Pune University',
      flow: {
        status: 'answered' as const,
        originalTask: 'Update my resume',
        questions: [{ question: 'Which university did you attend?' }],
        answers: [{ question: 'Which university did you attend?', answer: 'Pune University' }],
      },
    };
    saveConversation(convo({ messages: [{ role: 'user', text: 'Pune University', retry }] }));

    const loaded = loadConversations()[0].messages[0];
    expect(loaded.text).toBe('Pune University');
    expect(loaded.retry?.prompt).toBe(retry.prompt);
    expect(loaded.retry?.flow.originalTask).toBe('Update my resume');
    expect(loaded.retry?.flow.answers[0].answer).toBe('Pune University');
  });

  it('preserves complete retry recovery data while trimming only the display text', () => {
    const originalTask = `Tailor my resume with this context: ${'project detail '.repeat(400)}`;
    const prompt = `[Resuming the original task]\n\nOriginal task:\n${originalTask}\n\n${'fact '.repeat(1000)}`;
    const longAnswer = 'Built a production service with end-to-end ownership. '.repeat(30);
    const answers = Array.from({ length: 7 }, (_, i) => ({
      question: `Question ${i + 1}`,
      answer: i === 3 ? longAnswer : `Answer ${i + 1}`,
    }));
    const questions = answers.map((a) => ({ question: a.question }));
    const retry = {
      prompt,
      flow: { status: 'answered' as const, originalTask, questions, answers },
    };

    expect(prompt.length).toBeGreaterThan(4000);
    expect(longAnswer.length).toBeGreaterThan(1000);
    expect(answers.length).toBeGreaterThan(5);

    const saved = saveConversation(convo({
      messages: [{ role: 'user', text: 'x'.repeat(9000), retry }],
    }));
    expect(saved).toEqual({ ok: true });

    const loaded = loadConversations()[0].messages[0];
    expect(loaded.text.length).toBeLessThan(5000);
    expect(loaded.retry?.prompt).toBe(prompt);
    expect(loaded.retry?.flow.originalTask).toBe(originalTask);
    expect(loaded.retry?.flow.answers).toHaveLength(7);
    expect(loaded.retry?.flow.answers[3].answer).toBe(longAnswer);
  });

  it('reports a persistence failure instead of silently succeeding', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('Quota exceeded'); },
    });

    expect(saveConversation(convo())).toEqual({ ok: false, error: 'Quota exceeded' });
  });

  it('upserts and deletes', () => {
    const a = convo();
    const b = convo();
    saveConversation(a);
    saveConversation(b);
    expect(loadConversations().length).toBe(2);
    saveConversation({ ...a, messages: [...a.messages, { role: 'assistant', text: 'again' }] });
    expect(loadConversations().length).toBe(2);
    deleteConversation(b.id);
    const rest = loadConversations();
    expect(rest.length).toBe(1);
    expect(rest[0].id).toBe(a.id);
    deleteConversation(a.id);
    expect(loadConversations().length).toBe(0);
  });
});
