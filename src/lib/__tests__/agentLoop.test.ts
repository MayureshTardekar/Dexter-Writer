import { describe, expect, it } from 'vitest';
import { answerQuestion, beginQuestionFlow } from '../agent/questionFlow';
import { runAgent, type AgentRunOptions } from '../agent/loop';
import { INPUT_TOOL_DEFS } from '../agent/tools/input';
import type { ProviderChunk, ProviderStream, StreamEvent, ToolCall, ToolResult } from '../agent/types';
import type { ProviderRequest } from '../agent/providers';

function scriptedStream(rounds: ProviderChunk[][]) {
  const requests: ProviderRequest[] = [];
  let round = 0;

  const stream = (req: ProviderRequest): ProviderStream => {
    requests.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
    const chunks = rounds[round++];
    return (async function* () {
      if (!chunks) throw new Error('Unexpected extra provider call');
      for (const chunk of chunks) yield chunk;
    })();
  };

  return { stream, requests };
}

function baseOptions(stream: AgentRunOptions['stream'], overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
  return {
    provider: 'openai',
    apiKey: 'test-key',
    baseUrl: '',
    model: 'test-model',
    system: 'You are a careful document editor.',
    history: [],
    userText: 'Fill in the Jake resume template for my job application.',
    tools: INPUT_TOOL_DEFS,
    executeTool: async (call) => ({
      toolCallId: call.id,
      name: call.name,
      content: 'ok',
    }),
    stream,
    ...overrides,
  };
}

async function collect(opts: AgentRunOptions): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of runAgent(opts)) events.push(event);
  return events;
}

describe('agent loop missing-information pause', () => {
  it('asks for missing template details and does not run an edit from the same batch', async () => {
    const fake = scriptedStream([
      [
        { type: 'text', delta: 'I need a couple of details first.' },
        {
          type: 'tool_call',
          call: {
            id: 'edit-1',
            name: 'edit_document',
            args: { old_string: 'Your Name', new_string: 'Priya Raman' },
          },
        },
        {
          type: 'tool_call',
          call: {
            id: 'ask-1',
            name: 'request_user_input',
            args: {
              questions: [
                { question: 'What is your full name?' },
                { question: 'Which university did you attend?' },
              ],
            },
          },
        },
      ],
    ]);

    const executed: ToolCall[] = [];
    const events = await collect(baseOptions(fake.stream, {
      executeTool: async (call): Promise<ToolResult> => {
        executed.push(call);
        if (call.name === 'request_user_input') {
          return {
            toolCallId: call.id,
            name: call.name,
            content: 'Waiting for answers.',
            pause: true,
            questions: [
              { question: 'What is your full name?' },
              { question: 'Which university did you attend?' },
            ],
          };
        }
        return { toolCallId: call.id, name: call.name, content: 'edited', newContent: 'Priya Raman' };
      },
    }));

    expect(executed.map((c) => c.name)).toEqual(['request_user_input']);
    expect(fake.requests).toHaveLength(1);
    expect(events.filter((e) => e.type === 'tool_call').map((e) => e.call.name)).toEqual(['request_user_input']);
    expect(events.some((e) => e.type === 'tool_result' && e.result.name === 'edit_document')).toBe(false);
    expect(events).toContainEqual({ type: 'done', stopReason: 'needs_input' });
  });

  it('does not request another model round while waiting for the answer', async () => {
    const fake = scriptedStream([
      [{
        type: 'tool_call',
        call: {
          id: 'ask-1',
          name: 'request_user_input',
          args: { questions: [{ question: 'What graduation date should I use?' }] },
        },
      }],
      [{ type: 'tool_call', call: { id: 'edit-2', name: 'edit_document', args: {} } }],
    ]);

    const executed: string[] = [];
    const events = await collect(baseOptions(fake.stream, {
      executeTool: async (call) => {
        executed.push(call.name);
        return {
          toolCallId: call.id,
          name: call.name,
          content: 'Waiting for the answer.',
          pause: true,
          questions: [{ question: 'What graduation date should I use?' }],
        };
      },
    }));

    expect(executed).toEqual(['request_user_input']);
    expect(fake.requests).toHaveLength(1);
    expect(events.find((e) => e.type === 'done')).toEqual({ type: 'done', stopReason: 'needs_input' });
  });

  it('sends the original task and supplied answer when the user resumes', async () => {
    const flow = beginQuestionFlow('Tailor the Jake template resume to this backend job.', [
      { question: 'What is your full name?' },
      { question: 'Which university did you attend?' },
    ])!;
    const resumed = answerQuestion(flow, 'Priya Raman, Pune University')!;

    const fake = scriptedStream([[{ type: 'text', delta: 'Resumed and updated the resume.' }]]);
    await collect(baseOptions(fake.stream, { userText: resumed.prompt }));

    const sent = fake.requests[0].messages.at(-1);
    expect(sent?.role).toBe('user');
    expect(sent?.content).toContain('Original task:');
    expect(sent?.content).toContain('Tailor the Jake template resume to this backend job.');
    expect(sent?.content).toContain('Priya Raman, Pune University');
    expect(sent?.content).toMatch(/do not invent/i);
  });
});
