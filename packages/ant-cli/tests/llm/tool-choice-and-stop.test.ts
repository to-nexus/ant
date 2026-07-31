/**
 * Port `toolChoice` + OpenAI-compat `stop` mapping (sage-causing-rover RCA).
 *
 * The forced-final round used to DELETE the tool declarations while the
 * history still carried tool_calls — on OpenAI-compat providers (GLM) that
 * inconsistency reliably degenerated into repetition loops. The cure is the
 * provider-native constraint: tools stay declared, `tool_choice`/
 * `functionCallingConfig` forbids the call. All three adapters map it
 * day-one (a fallback-only adapter would fork behavior per provider on a
 * provider-selected seam).
 *
 * Also locks the independent `stopSequences` drop bug: OpenAILLMClient
 * silently discarded the port option, making runPlanWithTools' `</plan>`
 * hard-stop a no-op on GLM/DeepSeek (Anthropic/Gemini already honored it).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAILLMClient } from '../../src/periphery/adapters/llm/OpenAILLMClient';

const TOOLS = [
  { name: 'read_file', description: 'r', input_schema: { type: 'object', properties: {} } },
] as any;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Drive `stream(...)` and return the payload passed to chat.completions.create. */
async function captureCreatePayload(options: Record<string, any>): Promise<any> {
  const client = new OpenAILLMClient(undefined, {
    apiKey: 'test-key',
    modelName: 'glm-5.2',
    provider: 'glm',
  });
  const create = vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .mockImplementation(async () => (async function* () {})());
  (client as any).client = { chat: { completions: { create } } };

  const messages = [{ role: 'user', content: 'hi' }];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of client.stream(messages as any, options)) {
    /* drain */
  }
  expect(create).toHaveBeenCalledTimes(1);
  return create.mock.calls[0][0];
}

describe('OpenAI-compat toolChoice mapping', () => {
  it("toolChoice:'none' with declared tools → tools kept AND tool_choice:'none'", async () => {
    const payload = await captureCreatePayload({ tools: TOOLS, toolChoice: 'none' });
    expect(payload.tools).toHaveLength(1);
    expect(payload.tools[0].function.name).toBe('read_file');
    expect(payload.tool_choice).toBe('none');
  });

  it("toolChoice:'auto' with declared tools → tool_choice:'auto'", async () => {
    const payload = await captureCreatePayload({ tools: TOOLS, toolChoice: 'auto' });
    expect(payload.tool_choice).toBe('auto');
  });

  it('toolChoice WITHOUT tools → tool_choice omitted (OpenAI 400-guard)', async () => {
    const payload = await captureCreatePayload({ toolChoice: 'none' });
    expect(payload.tools).toBeUndefined();
    expect(payload.tool_choice).toBeUndefined();
  });

  it('toolChoice with an EMPTY tools array → tool_choice omitted', async () => {
    const payload = await captureCreatePayload({ tools: [], toolChoice: 'none' });
    expect(payload.tools).toBeUndefined();
    expect(payload.tool_choice).toBeUndefined();
  });

  it('no toolChoice → no tool_choice key (pre-change requests unchanged)', async () => {
    const payload = await captureCreatePayload({ tools: TOOLS });
    expect(payload.tool_choice).toBeUndefined();
  });
});

describe('OpenAI-compat stopSequences → stop mapping', () => {
  it('forwards stopSequences as `stop`', async () => {
    const payload = await captureCreatePayload({ stopSequences: ['</plan>'] });
    expect(payload.stop).toEqual(['</plan>']);
  });

  it('caps at 4 strings (OpenAI API contract)', async () => {
    const payload = await captureCreatePayload({ stopSequences: ['a', 'b', 'c', 'd', 'e'] });
    expect(payload.stop).toEqual(['a', 'b', 'c', 'd']);
  });

  it('omits `stop` when no stopSequences given', async () => {
    const payload = await captureCreatePayload({});
    expect(payload.stop).toBeUndefined();
  });
});

describe('Anthropic toolChoice mapping', () => {
  async function captureAnthropicPayload(options: Record<string, any>): Promise<any> {
    const { AnthropicLLMClient } = await import(
      '../../src/periphery/adapters/llm/AnthropicLLMClient'
    );
    const client = new AnthropicLLMClient(undefined, {
      apiKey: 'test-key',
      modelName: 'claude-sonnet-5',
    });
    const create = vi
      .fn()
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      .mockImplementation(async () => (async function* () {})());
    (client as any).client = { messages: { create } };

    const messages = [{ role: 'user', content: 'hi' }];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.stream(messages as any, options)) {
      /* drain */
    }
    expect(create).toHaveBeenCalledTimes(1);
    return create.mock.calls[0][0];
  }

  it("toolChoice:'none' with tools → tools kept AND tool_choice:{type:'none'}", async () => {
    const payload = await captureAnthropicPayload({ tools: TOOLS, toolChoice: 'none' });
    expect(payload.tools).toHaveLength(1);
    expect(payload.tool_choice).toEqual({ type: 'none' });
  });

  it('no toolChoice → no tool_choice key', async () => {
    const payload = await captureAnthropicPayload({ tools: TOOLS });
    expect(payload.tool_choice).toBeUndefined();
  });

  it('toolChoice without tools → neither tools nor tool_choice', async () => {
    const payload = await captureAnthropicPayload({ toolChoice: 'none' });
    expect(payload.tools).toBeUndefined();
    expect(payload.tool_choice).toBeUndefined();
  });
});

describe('OpenAI Responses toolChoice + stop mapping', () => {
  async function captureResponsesPayload(options: Record<string, any>): Promise<any> {
    const { OpenAIResponsesLLMClient } = await import(
      '../../src/periphery/adapters/llm/OpenAIResponsesLLMClient'
    );
    const client = new OpenAIResponsesLLMClient(undefined, {
      apiKey: 'test-key',
      modelName: 'gpt-5.6-terra',
    });
    const create = vi
      .fn()
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      .mockImplementation(async () => (async function* () {})());
    (client as any).client = { responses: { create } };

    const messages = [{ role: 'user', content: 'hi' }];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.stream(messages as any, options)) {
      /* drain */
    }
    expect(create).toHaveBeenCalledTimes(1);
    return create.mock.calls[0][0];
  }

  it("toolChoice:'none' with tools → tools kept AND tool_choice:'none'", async () => {
    const payload = await captureResponsesPayload({ tools: TOOLS, toolChoice: 'none' });
    expect(payload.tools).toHaveLength(1);
    expect(payload.tool_choice).toBe('none');
  });

  it('toolChoice without tools → neither tools nor tool_choice (400 guard)', async () => {
    const payload = await captureResponsesPayload({ toolChoice: 'none' });
    expect(payload.tools).toBeUndefined();
    expect(payload.tool_choice).toBeUndefined();
  });

  // The Responses API has no `stop` parameter at all — the port explicitly
  // permits an adapter to ignore an option it cannot express. Locked so nobody
  // "fixes" it by inventing a field the API will 400 on.
  it('drops stopSequences — the Responses API has no `stop` parameter', async () => {
    const payload = await captureResponsesPayload({ stopSequences: ['</plan>'] });
    expect(payload.stop).toBeUndefined();
    expect(payload.stop_sequences).toBeUndefined();
  });
});

describe('Gemini toolChoice mapping', () => {
  async function captureGeminiPayload(options: Record<string, any>): Promise<any> {
    const { GeminiLLMClient } = await import(
      '../../src/periphery/adapters/llm/GeminiLLMClient'
    );
    const client = new GeminiLLMClient(undefined, {
      apiKey: 'test-key',
      modelName: 'gemini-2.5-pro',
    });
    const generateContentStream = vi
      .fn()
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      .mockImplementation(async () => (async function* () {})());
    (client as any).client = { models: { generateContentStream } };

    const messages = [{ role: 'user', content: 'hi' }];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.stream(messages as any, options)) {
      /* drain */
    }
    expect(generateContentStream).toHaveBeenCalledTimes(1);
    return generateContentStream.mock.calls[0][0];
  }

  it("toolChoice:'none' with tools → tools kept AND functionCallingConfig NONE", async () => {
    const payload = await captureGeminiPayload({ tools: TOOLS, toolChoice: 'none' });
    expect(payload.config.tools).toBeDefined();
    expect(payload.config.toolConfig.functionCallingConfig.mode).toBe('NONE');
  });

  it('no toolChoice → no toolConfig', async () => {
    const payload = await captureGeminiPayload({ tools: TOOLS });
    expect(payload.config.toolConfig).toBeUndefined();
  });

  it('toolChoice without tools → no toolConfig (guard)', async () => {
    const payload = await captureGeminiPayload({ toolChoice: 'none' });
    expect(payload.config.tools).toBeUndefined();
    expect(payload.config.toolConfig).toBeUndefined();
  });
});
