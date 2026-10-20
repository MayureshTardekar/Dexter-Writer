/**
 * Canonical, provider-agnostic types for the Dexter Write agent engine.
 *
 * The whole point of this module is the `tool` role on {@link AgentMessage}.
 * The previous implementation flattened tool results into prose inside a
 * `user` turn, which left the model unable to tell which result belonged to
 * which call. See AI_AGENT_ROADMAP.md §2 (P1) and §4.
 */

/** One well-formed conversation turn. */
export type AgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: AgentImage[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

/** A model's request to run a tool. */
export interface ToolCall {
  /** Provider-issued id, or a locally synthesized `call_<n>` when the provider omits one. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** A focused missing-information question shown to the user. */
export interface MissingInfoQuestion {
  question: string;
  /** Optional short explanation of why the fact is needed. */
  reason?: string;
}

/** The outcome of running a {@link ToolCall}. */
export interface ToolResult {
  toolCallId: string;
  name: string;
  /** Text handed back to the model. Errors belong here too, phrased so the model can recover. */
  content: string;
  isError?: boolean;
  /** Set only when the tool mutated the ACTIVE document, so the caller can stage/apply it. */
  newContent?: string;
  /** Short label for the chat UI, e.g. `⚡ Replaced lines 12-18`. */
  badge?: string;
  /** When true, the loop stops and waits for the user instead of continuing to edit. */
  pause?: boolean;
  /** Questions the user must answer before the original task can resume. */
  questions?: MissingInfoQuestion[];
}

/** Tool name that pauses an agent turn until the user supplies missing facts. */
export const PAUSE_TOOL_NAME = 'request_user_input';

/** `read` and `external` are side-effect free; `doc` and `file` mutate state. */
export type ToolKind = 'read' | 'doc' | 'file' | 'external';

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema. Gemini needs this reduced — see sanitizeSchemaForGemini(). */
  parameters: Record<string, unknown>;
  kind: ToolKind;
}

/** Everything the UI needs, emitted as it happens. */
export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'round'; index: number; of: number }
  /** Non-fatal notices (tools unsupported, stream fell back, loop guard tripped). */
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'done'; stopReason: StopReason };

export type StopReason = 'complete' | 'aborted' | 'max_rounds' | 'needs_input' | 'error';

/**
 * Lets the engine read and write the surrounding project without importing
 * React state. `App.tsx` supplies the implementation over `files`/`setFiles`.
 */
export interface FileAccess {
  list(): Array<{ name: string; mode: string; lines: number; active: boolean }>;
  read(name: string): string | null;
  write(name: string, content: string): boolean;
  /**
   * Creates the file and returns its FINAL name, which may differ from the
   * requested one if it was de-duplicated. Returns null on failure. The real
   * name must reach the model, or its next read_file call will miss.
   */
  create(name: string, mode: string, content: string): string | null;
  activeName(): string;
  setActive?(name: string): boolean;
  /** Stable project-file id for an existing name, when the host can provide one. */
  idOf?(name: string): string | null;
}

/** What a provider adapter receives. */
export interface ProviderCallOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: AgentMessage[];
  tools: ToolDef[];
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** When false, skip SSE and do a single blocking request. */
  stream?: boolean;
}

/** What a provider adapter yields. */
export type ProviderChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  /** Adapter-level degradation notice, surfaced to the user but never fatal. */
  | { type: 'notice'; message: string };

export type ProviderStream = AsyncGenerator<ProviderChunk, void, void>;

/** Raised when the caller aborted; the loop converts it into a clean `done`. */
export const ABORT_MESSAGE = 'aborted';

export function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return true;
  if (e instanceof Error && (e.name === 'AbortError' || e.message === ABORT_MESSAGE)) return true;
  return false;
}

export interface AgentImage { mime: string; data: string; name: string }
