// AI playground conversation history — persisted locally so recent chats
// survive reloads and can be reopened. Message dumps are trimmed on save.

export interface StoredMessage {
  role: 'user' | 'assistant';
  text: string;
  badges?: string[];
}

export interface ChatConversation {
  id: string;
  title: string;
  fileName?: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
}

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

function trimMessages(messages: StoredMessage[]): StoredMessage[] {
  return messages.slice(-MAX_MSGS).map((m) => ({
    role: m.role,
    text: m.text.length > MAX_TEXT ? m.text.slice(0, MAX_TEXT) + '\n…(truncated)' : m.text,
    ...(m.badges && m.badges.length > 0 ? { badges: m.badges.slice(0, 12) } : {}),
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

function persist(all: ChatConversation[]): void {
  try {
    storage().setItem(LS_KEY, JSON.stringify(all.slice(0, MAX_CONVOS)));
  } catch { /* quota — ignore */ }
}

/** Upsert a conversation. Greeting-only chats (no user message) are skipped. */
export function saveConversation(conv: ChatConversation): void {
  if (!conv.messages.some((m) => m.role === 'user')) return;
  const all = loadConversations().filter((c) => c.id !== conv.id);
  const clean: ChatConversation = {
    ...conv,
    title: titleFor(conv.messages),
    messages: trimMessages(conv.messages),
    updatedAt: Date.now(),
  };
  persist([clean, ...all]);
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
