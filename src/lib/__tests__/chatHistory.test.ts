import { describe, it, expect, beforeEach } from 'vitest';
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
