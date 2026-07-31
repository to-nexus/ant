/**
 * OpenAIResponsesLLMClient — the Responses-API adapter behind the GPT-5.6
 * family (`ModelSpec.apiSurface === 'responses'`).
 *
 * Locks the axes where the Responses protocol diverges from Chat Completions
 * and a silent mismatch would be invisible until production:
 *  - request field names (`input` / `max_output_tokens`), flat tool shape
 *  - reasoning effort mapping + output-budget reserve (thinking starvation)
 *  - temperature suppression for reasoning models
 *  - stopReason derivation (`tool_use` is NOT reported by the API)
 *  - usage disjointness (cached input subtracted, reasoning not double-counted)
 *  - reasoning-item replay across tool rounds, and the defensive strip-retry
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  OpenAIResponsesLLMClient,
  normalizeResponsesUsage,
} from '../../src/periphery/adapters/llm/OpenAIResponsesLLMClient';
import {
  encodeReasoningEnvelope,
  decodeReasoningEnvelope,
  isReasoningEnvelope,
  REASONING_ENVELOPE_MAX_BYTES,
} from '../../src/core/llm/reasoningEnvelope';
import { MODEL_REGISTRY } from '@ant/shared';

const MODEL = 'gpt-5.6-terra';

const TOOLS = [
  { name: 'read_file', description: 'read a file', input_schema: { type: 'object', properties: {} } },
] as any;

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_REASONING_EFFORT;
});

function makeClient(modelName = MODEL) {
  return new OpenAIResponsesLLMClient(undefined, { apiKey: 'test-key', modelName });
}

/** Drive `stream(...)` over a canned event list and return [payload, events]. */
async function run(
  options: Record<string, any>,
  events: any[] = [],
  messages: any[] = [{ role: 'user', content: 'hi' }],
  modelName = MODEL,
) {
  const client = makeClient(modelName);
  const create = vi.fn().mockImplementation(async () => (async function* () {
    for (const e of events) yield e;
  })());
  (client as any).client = { responses: { create } };

  const out: any[] = [];
  for await (const ev of client.stream(messages, options)) out.push(ev);

  return { payload: create.mock.calls[0][0], events: out, create };
}

// ---------------------------------------------------------------------------

describe('registry wiring', () => {
  it.each(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])(
    '%s is registered as a selectable openai Responses model',
    (id) => {
      const spec = MODEL_REGISTRY[id];
      expect(spec).toBeDefined();
      expect(spec.provider).toBe('openai');
      expect(spec.apiSurface).toBe('responses');
      expect(spec.supportsTemperature).toBe(false);
      expect(spec.selectable).not.toBe(false);
      expect(spec.contextWindow).toBe(1_050_000);
      expect(spec.maxOutputTokens).toBe(128_000);
      // Anthropic thinking params must never be sent to a non-Anthropic model.
      expect(spec.thinkingMode).toBe('none');
    },
  );

  it('routes through the Responses client, not the Chat Completions one', async () => {
    const { createLLMClient } = await import('../../src/periphery/adapters/llm/LLMClientFactory');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const client = createLLMClient(undefined, undefined, { jobType: 'code' }, {
      llmModels: { code: { default: MODEL } },
    });
    expect(client).toBeInstanceOf(OpenAIResponsesLLMClient);
    expect(client.modelName).toBe(MODEL);
    expect(client.provider).toBe('openai');
    vi.unstubAllEnvs();
  });
});

describe('request shape', () => {
  it('uses `input` + `max_output_tokens` (never chat field names)', async () => {
    const { payload } = await run({ maxTokens: 4000 });
    expect(payload.input).toBeDefined();
    expect(payload.messages).toBeUndefined();
    expect(payload.max_tokens).toBeUndefined();
    expect(payload.max_output_tokens).toBeDefined();
    expect(payload.stream).toBe(true);
  });

  // `tool_choice` / `stopSequences` mapping lives in the cross-adapter axis
  // file (tests/llm/tool-choice-and-stop.test.ts) — one file per axis.
  it('declares tools FLAT — no nested `function` wrapper (Chat Completions shape)', async () => {
    const { payload } = await run({ tools: TOOLS, toolChoice: 'auto' });
    expect(payload.tools).toHaveLength(1);
    expect(payload.tools[0]).toMatchObject({ type: 'function', name: 'read_file' });
    expect(payload.tools[0].function).toBeUndefined();
    expect(payload.tools[0].parameters).toEqual(TOOLS[0].input_schema);
  });

  it('never sends temperature for a supportsTemperature:false model', async () => {
    const { payload } = await run({ temperature: 0.2 });
    expect(payload.temperature).toBeUndefined();
  });

  it('opts into encrypted reasoning content and stays stateless', async () => {
    const { payload } = await run({});
    expect(payload.store).toBe(false);
    expect(payload.include).toContain('reasoning.encrypted_content');
    // summary is what keeps events flowing during a long reasoning phase —
    // without it the idle watchdog reads silence as a stalled socket.
    expect(payload.reasoning.summary).toBe('auto');
  });

});

describe('reasoning effort + output budget', () => {
  it('enabled thinking → high effort; explicit disable → low', async () => {
    expect((await run({})).payload.reasoning.effort).toBe('high');
    expect((await run({ enableThinking: true })).payload.reasoning.effort).toBe('high');
    expect((await run({ enableThinking: false })).payload.reasoning.effort).toBe('low');
  });

  it('OPENAI_REASONING_EFFORT overrides both directions', async () => {
    process.env.OPENAI_REASONING_EFFORT = 'medium';
    expect((await run({ enableThinking: false })).payload.reasoning.effort).toBe('medium');
  });

  it('adds a per-effort reserve so reasoning cannot eat the text budget', async () => {
    const high = await run({ maxTokens: 8_000 });
    expect(high.payload.max_output_tokens).toBe(8_000 + 24_000);

    const low = await run({ maxTokens: 8_000, enableThinking: false });
    expect(low.payload.max_output_tokens).toBe(8_000 + 2_000);
  });

  it("clamps to the model's declared output ceiling", async () => {
    const { payload } = await run({ maxTokens: 200_000 });
    expect(payload.max_output_tokens).toBe(MODEL_REGISTRY[MODEL].maxOutputTokens);
  });
});

describe('input item conversion', () => {
  it('maps tool_use → function_call and tool_result → function_call_output', async () => {
    const { payload } = await run({}, [], [
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling' },
          { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a.ts' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', tool_name: 'read_file', content: 'file body' }],
      },
    ]);

    const call = payload.input.find((i: any) => i.type === 'function_call');
    expect(call).toMatchObject({ call_id: 'call_1', name: 'read_file' });
    expect(JSON.parse(call.arguments)).toEqual({ path: 'a.ts' });

    const output = payload.input.find((i: any) => i.type === 'function_call_output');
    expect(output).toMatchObject({ call_id: 'call_1', output: 'file body' });

    // The assistant text rides as its own message item, before the call.
    expect(payload.input.findIndex((i: any) => i.content === 'calling'))
      .toBeLessThan(payload.input.indexOf(call));
  });

  it('maps images to input_image data URLs', async () => {
    const { payload } = await run({}, [], [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
        ],
      },
    ]);
    const parts = payload.input[0].content;
    expect(parts[0]).toEqual({ type: 'input_text', text: 'look' });
    expect(parts[1]).toEqual({ type: 'input_image', image_url: 'data:image/png;base64,AAA' });
  });
});

describe('stream event mapping', () => {
  const textDelta = { type: 'response.output_text.delta', delta: 'hello' };
  const completed = (response: any) => ({ type: 'response.completed', response });

  it('maps text and reasoning summary deltas', async () => {
    const { events } = await run({}, [
      { type: 'response.reasoning_summary_text.delta', delta: 'pondering' },
      textDelta,
      completed({ status: 'completed', usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } }),
    ]);
    expect(events.find((e) => e.type === 'thinking')?.thinking).toBe('pondering');
    expect(events.find((e) => e.type === 'text')?.text).toBe('hello');
  });

  it("derives stopReason 'tool_use' — the API reports status 'completed' for tool turns", async () => {
    const { events } = await run({ tools: TOOLS }, [
      {
        type: 'response.output_item.done',
        item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"path":"a.ts"}' },
      },
      completed({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }),
    ]);

    const toolUse = events.find((e) => e.type === 'tool_use');
    expect(toolUse?.toolUse).toMatchObject({ id: 'call_1', name: 'read_file', input: { path: 'a.ts' } });
    expect(events[events.length - 1]).toMatchObject({ type: 'done', stopReason: 'tool_use' });
  });

  it("maps incomplete/max_output_tokens → 'max_tokens', plain completion → 'end_turn'", async () => {
    const truncated = await run({}, [
      textDelta,
      {
        type: 'response.incomplete',
        response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
      },
    ]);
    expect(truncated.events[truncated.events.length - 1]).toMatchObject({ stopReason: 'max_tokens' });

    const clean = await run({}, [textDelta, completed({ status: 'completed' })]);
    expect(clean.events[clean.events.length - 1]).toMatchObject({ stopReason: 'end_turn' });
  });

  it('never drops a tool call on unparseable arguments', async () => {
    const { events } = await run({ tools: TOOLS }, [
      {
        type: 'response.output_item.done',
        item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{bad json' },
      },
      completed({ status: 'completed' }),
    ]);
    expect(events.find((e) => e.type === 'tool_use')?.toolUse?.input).toEqual({});
  });

  it('surfaces response.failed as an error event', async () => {
    const { events } = await run({}, [
      { type: 'response.failed', response: { status: 'failed', error: { code: 'server_error', message: 'boom' } } },
    ]);
    expect(events.find((e) => e.type === 'error')?.error).toMatchObject({ code: 'server_error', message: 'boom' });
  });
});

describe('usage normalization', () => {
  it('subtracts cached input so the axes stay disjoint', () => {
    expect(normalizeResponsesUsage({
      input_tokens: 1000,
      output_tokens: 200,
      total_tokens: 1200,
      input_tokens_details: { cached_tokens: 800 },
    })).toEqual({ inputTokens: 200, outputTokens: 200, totalTokens: 1200, cacheReadTokens: 800 });
  });

  it('does NOT add reasoning tokens on top of output (already included)', () => {
    const usage = normalizeResponsesUsage({
      input_tokens: 10,
      output_tokens: 500,
      total_tokens: 510,
      output_tokens_details: { reasoning_tokens: 400 },
    });
    expect(usage?.outputTokens).toBe(500);
  });

  it('omits cacheReadTokens when nothing was cached', () => {
    const usage = normalizeResponsesUsage({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
    expect(usage).not.toHaveProperty('cacheReadTokens');
  });
});

describe('reasoning envelope', () => {
  it('round-trips items through the signature field', () => {
    const items = [{ id: 'rs_1', encryptedContent: 'abc' }, { id: 'rs_2' }];
    const sig = encodeReasoningEnvelope(items)!;
    expect(isReasoningEnvelope(sig)).toBe(true);
    expect(decodeReasoningEnvelope(sig)).toEqual(items);
  });

  it('treats a foreign (Anthropic) signature as no reasoning', () => {
    expect(isReasoningEnvelope('ErUBCkYIBRgCKkC...')).toBe(false);
    expect(decodeReasoningEnvelope('ErUBCkYIBRgCKkC...')).toEqual([]);
    expect(decodeReasoningEnvelope(undefined)).toEqual([]);
  });

  it('drops the OLDEST items to stay under the size cap', () => {
    // ~133KB base64 each: one fits under the 256KB cap, two do not.
    const big = 'x'.repeat(100_000);
    const sig = encodeReasoningEnvelope([
      { id: 'rs_old', encryptedContent: big },
      { id: 'rs_new', encryptedContent: big },
    ])!;
    expect(Buffer.byteLength(sig, 'utf8')).toBeLessThanOrEqual(REASONING_ENVELOPE_MAX_BYTES);
    expect(decodeReasoningEnvelope(sig).map((i) => i.id)).toEqual(['rs_new']);
  });

  it('emits an envelope signature after a reasoning round', async () => {
    const { events } = await run({}, [
      { type: 'response.reasoning_summary_text.delta', delta: 'thinking' },
      {
        type: 'response.output_item.done',
        item: { type: 'reasoning', id: 'rs_1', encrypted_content: 'cipher' },
      },
      { type: 'response.completed', response: { status: 'completed' } },
    ]);
    const signed = events.find((e) => e.type === 'thinking' && e.signature);
    expect(decodeReasoningEnvelope(signed?.signature)).toEqual([
      { id: 'rs_1', encryptedContent: 'cipher' },
    ]);
  });

  it('materializes a thinking block even when the model emitted no summary text', async () => {
    // Upstream accumulators only push a thinking block when some thinking TEXT
    // was seen — without this the envelope (and the whole chain of thought)
    // would be silently lost on summary-less rounds.
    const { events } = await run({}, [
      { type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs_1', encrypted_content: 'c' } },
      { type: 'response.completed', response: { status: 'completed' } },
    ]);
    const thinkingText = events.filter((e) => e.type === 'thinking').map((e) => e.thinking).join('');
    expect(thinkingText).toBe('​'); // truthy for the accumulators, invisible in the UI
    const signed = events.find((e) => e.type === 'thinking' && e.signature);
    expect(decodeReasoningEnvelope(signed?.signature)).toHaveLength(1);
  });

  it('replays decoded reasoning items as input items on the next round', async () => {
    const sig = encodeReasoningEnvelope([{ id: 'rs_1', encryptedContent: 'cipher' }])!;
    const { payload } = await run({}, [], [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'plan', signature: sig },
          { type: 'tool_use', id: 'call_1', name: 'read_file', input: {} },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', tool_name: 'read_file', content: 'ok' }] },
    ]);

    const reasoning = payload.input.find((i: any) => i.type === 'reasoning');
    expect(reasoning).toMatchObject({ id: 'rs_1', encrypted_content: 'cipher' });
    // Must precede the function_call it belongs to.
    expect(payload.input.indexOf(reasoning))
      .toBeLessThan(payload.input.findIndex((i: any) => i.type === 'function_call'));
  });

  it('retries once WITHOUT reasoning items when the API rejects the replay', async () => {
    const sig = encodeReasoningEnvelope([{ id: 'rs_stale' }])!;
    const client = makeClient();
    const create = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Invalid reasoning item id'), { status: 400 }))
      .mockImplementationOnce(async () => (async function* () {
        yield { type: 'response.completed', response: { status: 'completed' } };
      })());
    (client as any).client = { responses: { create } };

    const messages = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'p', signature: sig }] },
      { role: 'user', content: 'again' },
    ];
    for await (const _ of client.stream(messages as any, {})) { /* drain */ }

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].input.some((i: any) => i.type === 'reasoning')).toBe(true);
    expect(create.mock.calls[1][0].input.some((i: any) => i.type === 'reasoning')).toBe(false);
  });
});

describe('cross-provider signature guard', () => {
  it('Anthropic drops thinking blocks carrying an OpenAI reasoning envelope', async () => {
    const { AnthropicLLMClient } = await import('../../src/periphery/adapters/llm/AnthropicLLMClient');
    const client = new AnthropicLLMClient(undefined, { apiKey: 'k', modelName: 'claude-sonnet-5' });
    const create = vi.fn().mockImplementation(async () => (async function* () {})());
    (client as any).client = { messages: { create } };

    const sig = encodeReasoningEnvelope([{ id: 'rs_1', encryptedContent: 'cipher' }])!;
    const messages = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'from openai', signature: sig },
          { type: 'text', text: 'answer' },
        ],
      },
      { role: 'user', content: 'again' },
    ];
    for await (const _ of client.stream(messages as any, {})) { /* drain */ }

    const sent = create.mock.calls[0][0].messages;
    const blocks = sent.flatMap((m: any) => (Array.isArray(m.content) ? m.content : []));
    expect(blocks.some((b: any) => b.type === 'thinking')).toBe(false);
    expect(blocks.some((b: any) => b.type === 'text' && b.text === 'answer')).toBe(true);
  });
});
