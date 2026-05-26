import { describe, it, expect, vi, beforeAll } from 'vitest';
import { callLLMWithToolLoop } from '../../src/agents/common/llm/callLLMWithToolLoop';
import type { LLMClient, LLMStreamEvent } from '../../src/core/ports/llm';

/**
 * Tool-use (RAG) path coverage for the per-`<task>` streaming hook.
 *
 * `callLLMWithToolLoop` runs in code-job decompose whenever any tool
 * is passed (which is always — read_file/list_files/clarify are mandatory). Without
 * the streaming hook wired here, decompose runs would only deliver the
 * Kanban broadcast at end-of-stream because the tool-loop never fed
 * `event.text` chunks through the XMLStreamParser. These tests lock
 * that behaviour in.
 */

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** Minimal stub LLMClient yielding pre-scripted events per round. */
function makeStubLLM(rounds: LLMStreamEvent[][]): LLMClient {
  let roundIdx = 0;
  return {
    provider: 'stub',
    modelName: 'stub',
    invoke: async () => '',
    async *stream() {
      const events = rounds[roundIdx] ?? [];
      roundIdx++;
      for (const e of events) {
        yield e;
      }
    },
  } as unknown as LLMClient;
}

const textEvent = (text: string): LLMStreamEvent => ({ type: 'text', text });
const toolUseEvent = (id: string, name: string, input: Record<string, any>): LLMStreamEvent => ({
  type: 'tool_use',
  toolUse: { id, name, input },
});

describe('callLLMWithToolLoop — per-<task> streaming hook', () => {
  it('forwards every <task> element to onTaskParsed in single-round flow', async () => {
    // Single round: LLM emits the final response with <tasks> directly.
    const finalText =
      '<tasks>' +
      '<task>{"id":"a","name":"A","type":"feature","priority":300}</task>' +
      '<task>{"id":"b","name":"B","type":"feature","priority":400}</task>' +
      '</tasks>';
    const llm = makeStubLLM([
      // Stream the body in many small chunks to mimic real token streaming
      // and exercise the parser's chunk-boundary lookahead.
      finalText.split('').map(textEvent),
    ]);

    const observed: string[] = [];
    const result = await callLLMWithToolLoop(
      llm,
      [{ role: 'user', content: 'go' }],
      [{ name: 'noop', description: 'noop', input_schema: { type: 'object', properties: {}, required: [] } }],
      async () => '',
      {
        temperature: 0,
        maxTokens: 1000,
        onTaskParsed: (rawJson) => {
          observed.push(JSON.parse(rawJson).id);
        },
      },
    );

    expect(observed).toEqual(['a', 'b']);
    expect(result.response).toBe(finalText);
  });

  it('only emits task_added in the final round (tool-call rounds carry no <task>)', async () => {
    // Round 0: LLM reasons + calls a tool. No <task> elements.
    // Round 1: LLM emits the final answer with <tasks>.
    const llm = makeStubLLM([
      [
        textEvent('Let me look up the spec.'),
        toolUseEvent('t1', 'noop', { foo: 'bar' }),
      ],
      [
        textEvent('<tasks><task>{"id":"only","name":"Only","type":"feature","priority":300}</task></tasks>'),
      ],
    ]);

    const observed: string[] = [];
    await callLLMWithToolLoop(
      llm,
      [{ role: 'user', content: 'go' }],
      [{ name: 'noop', description: 'noop', input_schema: { type: 'object', properties: {}, required: [] } }],
      async () => 'result',
      {
        temperature: 0,
        maxTokens: 1000,
        onTaskParsed: (rawJson) => {
          observed.push(JSON.parse(rawJson).id);
        },
      },
    );

    expect(observed).toEqual(['only']);
  });

  it('resets the parser on `event.type === "retry"` so a network retry replays cleanly', async () => {
    // The first half of the round emits a partial <task>, then retry,
    // then the full <tasks> block. Without parser reset on retry, the
    // first partial task body would still be buffered when the second
    // attempt's `<task>` arrives, and the resulting `task_added` would
    // contain merged garbage. The dedupe layer in the caller is the
    // last line of defence; this test pins the parser-level reset so
    // that layer never sees mid-stream corruption.
    const llm = makeStubLLM([
      [
        textEvent('<tasks><task>{"id":"par'),
        { type: 'retry' } as LLMStreamEvent,
        textEvent(
          '<tasks><task>{"id":"a","name":"A","type":"feature","priority":300}</task></tasks>'
        ),
      ],
    ]);

    const observed: string[] = [];
    await callLLMWithToolLoop(
      llm,
      [{ role: 'user', content: 'go' }],
      [{ name: 'noop', description: 'noop', input_schema: { type: 'object', properties: {}, required: [] } }],
      async () => '',
      {
        temperature: 0,
        maxTokens: 1000,
        onTaskParsed: (rawJson) => {
          observed.push(rawJson);
        },
      },
    );

    expect(observed).toHaveLength(1);
    const parsed = JSON.parse(observed[0]);
    expect(parsed.id).toBe('a');
    // Make sure the partial body from before the retry did NOT bleed in.
    expect(observed[0]).not.toContain('par');
  });

  it('is a no-op when onTaskParsed is omitted (existing callers unaffected)', async () => {
    // Sanity check: callers that do not pass onTaskParsed (e.g. design
    // decompose) must not pay the per-event parser cost and must
    // continue to receive the canonical response string verbatim.
    const finalText = '<tasks><task>{"id":"a","name":"A","type":"feature","priority":300}</task></tasks>';
    const llm = makeStubLLM([[textEvent(finalText)]]);

    const result = await callLLMWithToolLoop(
      llm,
      [{ role: 'user', content: 'go' }],
      [{ name: 'noop', description: 'noop', input_schema: { type: 'object', properties: {}, required: [] } }],
      async () => '',
      { temperature: 0, maxTokens: 1000 },
    );

    expect(result.response).toBe(finalText);
  });
});
