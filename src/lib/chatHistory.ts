// AI playground conversation history — persisted locally so recent chats
// survive reloads and can be reopened. Display text is trimmed on save; retry
// recovery data is preserved in full.

import type { RetryTurn } from './agent/questionFlow';

export interface StoredMessage {
  role: 'user' | 'assistant';
  text: string;
  badges?: string[];
  /** Context needed to Retry a resumed missing-information turn. */
  retry?: RetryTurn;
  sourceText?: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  fileName?: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
  factNotes?: string;
  writingStyle?: string;
}

export type SaveConversationResult =
  | { ok: true }
  | { ok: false; error: string };

const LS_KEY = 'dexter-write:chat-history:v1';
const MAX_CONVOS = 20;
const MAX_MSGS = 60;
const MAX_TEXT = 4000;

function uid(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const memFallback = new Map<string, string>();

function memStore(): Storage {
  return {
    getItem: (k: string) => (memFallback.has(k) ? memFallback.get(k)! : null),
    setItem: (k: string, v: string) => { memFallback.set(k, v); },
    removeItem: (k: string) => { memFallback.delete(k); },
    clear: () => memFallback.clear(),
    key: (i: number) => [...memFallback.keys()][i] ?? null,
    get length() { return memFallback.size; },
  };
}

function storage(): Storage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* fall through to memory */ }
  return memStore();
}

export function newConversationId(): string {
  return uid();
}

export function titleFor(messages: StoredMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  const raw = (first?.text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return 'New conversation';
  return raw.length > 44 ? `${raw.slice(0, 44)}…` : raw;
}

function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? text.slice(0, max) + '\n…(truncated)' : text;
}

/** Recovery data is copied in full; display-message limits must never apply. */
function preserveRetry(retry: RetryTurn): RetryTurn {
  return {
    prompt: retry.prompt,
    ...(retry.target ? { target: { ...retry.target } } : {}),
    flow: {
      status: retry.flow.status,
      originalTask: retry.flow.originalTask,
      questions: retry.flow.questions.map((q) => ({ ...q })),
      answers: retry.flow.answers.map((a) => ({ ...a })),
    },
  };
}

/** Trim only what the transcript displays. Retry metadata is preserved whole. */
function trimDisplayMessages(messages: StoredMessage[]): StoredMessage[] {
  return messages.slice(-MAX_MSGS).map((m) => ({
    role: m.role,
    text: clip(m.text),
    ...(m.sourceText ? { sourceText: m.sourceText } : {}),
    ...(m.badges && m.badges.length > 0 ? { badges: m.badges.slice(0, 12) } : {}),
    ...(m.retry ? { retry: preserveRetry(m.retry) } : {}),
  }));
}

export function loadConversations(): ChatConversation[] {
  try {
    const raw = storage().getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as ChatConversation[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages) && c.messages.length > 0)
      .slice(0, MAX_CONVOS);
  } catch {
    return [];
  }
}

function persist(all: ChatConversation[]): SaveConversationResult {
  try {
    storage().setItem(LS_KEY, JSON.stringify(all.slice(0, MAX_CONVOS)));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Upsert a conversation. Greeting-only chats (no user message) are skipped. */
export function saveConversation(conv: ChatConversation): SaveConversationResult {
  if (!conv.messages.some((m) => m.role === 'user')) return { ok: true };
  const all = loadConversations().filter((c) => c.id !== conv.id);
  const clean: ChatConversation = {
    ...conv,
    title: titleFor(conv.messages),
    messages: trimDisplayMessages(conv.messages),
    updatedAt: Date.now(),
  };
  return persist([clean, ...all]);
}

export function deleteConversation(id: string): ChatConversation[] {
  const rest = loadConversations().filter((c) => c.id !== id);
  persist(rest);
  return rest;
}

/** Test/maintenance helper: wipe all stored conversations. */
export function clearConversations(): void {
  try {
    storage().removeItem(LS_KEY);
  } catch { /* ignore */ }
}
