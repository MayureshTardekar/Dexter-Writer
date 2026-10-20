import type { AgentImage, AgentMessage, StreamEvent, ToolCall, ToolDef, ToolResult } from './types';
import { PAUSE_TOOL_NAME, isAbortError } from './types';
import { streamProvider } from './providers';
import type { ProviderRequest } from './providers';

/**
 * The agent loop. See AI_AGENT_ROADMAP.md §6.
 *
 * Every round appends a well-formed trace:
 *   assistant(content, toolCalls) → tool(toolCallId) × N → next round
 *
 * That shape is the whole reason this module exists. The previous
 * implementation flattened results into prose in a `user` turn, so the model
 * could not tell which result belonged to which call.
 */

export interface AgentRunOptions {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Full system prompt (see prompt.ts). */
  system: string;
  /** Prior turns, already trimmed by the caller. */
  history: AgentMessage[];
  userText: string;
  images?: AgentImage[];
  tools: ToolDef[];
  executeTool: (call: ToolCall) => Promise<ToolResult>;
  signal?: AbortSignal;
  maxRounds?: number;
  maxToolsPerRound?: number;
  temperature?: number;
  /** When provided, every message the loop builds is pushed here for persistence. */
  transcript?: AgentMessage[];
  /** Override the provider transport. Tests use this to script model responses. */
  stream?: (req: ProviderRequest) => ReturnType<typeof streamProvider>;
}

const DEFAULT_MAX_ROUNDS = 8;
const DEFAULT_MAX_TOOLS_PER_ROUND = 12;
/** Identical consecutive tool batches tolerated before intervening. */
const REPEAT_LIMIT = 2;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function* runAgent(opts: AgentRunOptions): AsyncGenerator<StreamEvent, void, void> {
  const maxRounds = opts.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxTools = opts.maxToolsPerRound ?? DEFAULT_MAX_TOOLS_PER_ROUND;
  const stream = opts.stream ?? streamProvider;

  const messages: AgentMessage[] = [
    { role: 'system', content: opts.system },
    ...opts.history,
    { role: 'user', content: opts.userText, ...(opts.images?.length ? { images: opts.images } : {}) },
  ];
  const record = (m: AgentMessage) => {
    messages.push(m);
    opts.transcript?.push(m);
  };

  let repeatKey = '';
  let repeats = 0;

  try {
    for (let round = 0; round < maxRounds; round++) {
      if (opts.signal?.aborted) {
        yield { type: 'done', stopReason: 'aborted' };
        return;
      }
      yield { type: 'round', index: round + 1, of: maxRounds };

      let text = '';
      const calls: ToolCall[] = [];

      for await (const chunk of stream({
        provider: opts.provider,
        apiKey: opts.apiKey,
        baseUrl: opts.baseUrl,
        model: opts.model,
        messages,
        tools: opts.tools,
        signal: opts.signal,
        temperature: opts.temperature,
      })) {
        if (opts.signal?.aborted) break;
        if (chunk.type === 'text') {
          text += chunk.delta;
          yield { type: 'text', delta: chunk.delta };
        } else if (chunk.type === 'notice') {
          yield { type: 'notice', message: chunk.message };
        } else {
          calls.push(chunk.call);
        }
      }

      if (opts.signal?.aborted) {
        yield { type: 'done', stopReason: 'aborted' };
        return;
      }

      // No tools requested — the model is done talking.
      if (calls.length === 0) {
        if (text) record({ role: 'assistant', content: text });
        yield { type: 'done', stopReason: 'complete' };
        return;
      }

      const pauseCall = calls.find((c) => c.name === PAUSE_TOOL_NAME);
      // If the model asked for missing facts, run ONLY that call. Any edit in
      // the same batch must wait: guessing and editing before the answer is
      // exactly the failure mode this tool exists to prevent.
      const batch = pauseCall ? [pauseCall] : calls.slice(0, maxTools);
      if (!pauseCall && calls.length > batch.length) {
        yield { type: 'notice', message: `Capped at ${maxTools} tool calls this round (model requested ${calls.length}).` };
      }
      if (pauseCall && calls.length > 1) {
        yield {
          type: 'notice',
          message: `Held ${calls.length - 1} other tool call${calls.length === 2 ? '' : 's'} until you answer the question.`,
        };
      }

      for (const call of batch) yield { type: 'tool_call', call };

      // Only the executed calls go into the trace, so every tool_call id has a
      // matching tool result — providers reject unmatched ids.
      record({ role: 'assistant', content: text, toolCalls: batch });

      const key = JSON.stringify(batch.map((c) => [c.name, c.args]));
      if (key === repeatKey) repeats += 1;
      else {
        repeatKey = key;
        repeats = 0;
      }

      for (const call of batch) {
        if (opts.signal?.aborted) {
          yield { type: 'done', stopReason: 'aborted' };
          return;
        }
        let result: ToolResult;
        try {
          result = await opts.executeTool(call);
        } catch (e) {
          if (isAbortError(e)) {
            yield { type: 'done', stopReason: 'aborted' };
            return;
          }
          result = {
            toolCallId: call.id,
            name: call.name,
            content: `Tool threw an exception: ${errorText(e)}. Fix the arguments and retry, or explain the problem to the user.`,
            isError: true,
          };
        }
        record({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: result.content,
          isError: result.isError,
        });
        yield { type: 'tool_result', result };
        if (result.pause) {
          yield { type: 'done', stopReason: 'needs_input' };
          return;
        }
      }

      // Free-tier models often retry the same failing call forever.
      if (repeats >= REPEAT_LIMIT) {
        record({
          role: 'user',
          content:
            'STOP CALLING TOOLS. You have issued the same tool call repeatedly with the same arguments. '
            + 'Do not call it again. Either try a materially different approach, or explain to the user in plain text what is blocking you.',
        });
        yield { type: 'notice', message: 'Repeated identical tool call detected — asked the model to stop and explain.' };
        repeats = 0;
      }
    }

    yield { type: 'notice', message: `Reached the ${maxRounds}-round limit. Ask me to continue if the work is unfinished.` };
    yield { type: 'done', stopReason: 'max_rounds' };
  } catch (e) {
    if (isAbortError(e)) {
      yield { type: 'done', stopReason: 'aborted' };
      return;
    }
    yield { type: 'error', message: errorText(e), fatal: true };
    yield { type: 'done', stopReason: 'error' };
  }
}
