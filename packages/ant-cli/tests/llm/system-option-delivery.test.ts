/**
 * Port `options.system` delivery contract (jade-blessing-brass RCA).
 *
 * `options.system` is a hard cross-adapter contract (core/ports/llm.ts):
 * AnthropicLLMClient maps it to the API `system` param; every other adapter
 * must materialize it via `applySystemOption`. The OpenAI-compat adapter
 * silently dropped it, so GLM ran the entire universal job (detect rubric,
 * runtime rules, custom definition, platform identity) with NO system prompt
 * — detect's `<executionTier>` contract never arrived, every turn floored to
 * Tier 0, and the agent hallucinated what "Ant" is.
 *
 * One row per adapter × method: the system text must reach the provider
 * request. Plus the helper's priority semantics (options.system replaces
 * message-embedded system roles) and the no-op passthrough.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAILLMClient } from '../../src/periphery/adapters/llm/OpenAILLMClient';
import { GeminiLLMClient } from '../../src/periphery/adapters/llm/GeminiLLMClient';
import { OpenAIResponsesLLMClient } from '../../src/periphery/adapters/llm/OpenAIResponsesLLMClient';
import { applySystemOption } from '../../src/core/utils/sanitizeMessages';

const SYSTEM = 'You are the Ant platform test harness.';
const USER_MSG = [{ role: 'user', content: 'hi' }];

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── helper semantics ───────────────────────────────────────────────────────

describe('applySystemOption', () => {
  it('prepends a system message when system is non-blank', () => {
    const out = applySystemOption(USER_MSG as any, SYSTEM);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ role: 'system', content: SYSTEM });
    expect(out[1]).toBe(USER_MSG[0]);
  });

  it('options.system WINS over message-embedded system roles (single system)', () => {
    const messages = [
      { role: 'system', content: 'embedded system' },
      { role: 'user', content: 'hi' },
    ];
    const out = applySystemOption(messages as any, SYSTEM);
    expect(out.filter((m) => m.role === 'system')).toHaveLength(1);
    expect(out[0].content).toBe(SYSTEM);
  });

  it('absent/blank system → messages pass through untouched (same reference)', () => {
    expect(applySystemOption(USER_MSG as any, undefined)).toBe(USER_MSG);
    expect(applySystemOption(USER_MSG as any, '  ')).toBe(USER_MSG);
  });
});

// ─── OpenAI-compat (GLM / DeepSeek / Kimi) ──────────────────────────────────

function makeOpenAIClient(): { client: OpenAILLMClient; create: ReturnType<typeof vi.fn> } {
  const client = new OpenAILLMClient(undefined, {
    apiKey: 'test-key',
    modelName: 'glm-5.2',
    provider: 'glm',
  });
  const create = vi.fn();
  (client as any).client = { chat: { completions: { create } } };
  return { client, create };
}

describe('OpenAI-compat options.system delivery', () => {
  it('invokeWithUsage → leading role:system message in the request', async () => {
    const { client, create } = makeOpenAIClient();
    create.mockResolvedValue({ choices: [{ message: { content: 'ok' } }], usage: undefined });
    await client.invokeWithUsage(USER_MSG as any, { system: SYSTEM });
    const payload = create.mock.calls[0][0];
    expect(payload.messages[0]).toEqual({ role: 'system', content: SYSTEM });
    expect(payload.messages[1].role).toBe('user');
  });

  it('stream → leading role:system message in the request', async () => {
    const { client, create } = makeOpenAIClient();
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    create.mockImplementation(async () => (async function* () {})());
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.stream(USER_MSG as any, { system: SYSTEM })) {
      /* drain */
    }
    const payload = create.mock.calls[0][0];
    expect(payload.messages[0]).toEqual({ role: 'system', content: SYSTEM });
  });

  it('invokeStructured → leading role:system message in the request', async () => {
    const { client, create } = makeOpenAIClient();
    create.mockResolvedValue({ choices: [{ message: { content: '{}' } }], usage: undefined });
    await client.invokeStructured(USER_MSG as any, { type: 'object' }, 'test', { system: SYSTEM } as any);
    const payload = create.mock.calls[0][0];
    expect(payload.messages[0]).toEqual({ role: 'system', content: SYSTEM });
  });

  it('no options.system → no system message injected', async () => {
    const { client, create } = makeOpenAIClient();
    create.mockResolvedValue({ choices: [{ message: { content: 'ok' } }], usage: undefined });
    await client.invokeWithUsage(USER_MSG as any, {});
    const payload = create.mock.calls[0][0];
    expect(payload.messages.some((m: any) => m.role === 'system')).toBe(false);
  });
});

// ─── Gemini ─────────────────────────────────────────────────────────────────

function makeGeminiClient(): { client: GeminiLLMClient; generateContent: ReturnType<typeof vi.fn> } {
  const client = new GeminiLLMClient(undefined, {
    apiKey: 'test-key',
    modelName: 'gemini-3-flash',
  });
  const generateContent = vi.fn().mockResolvedValue({ text: 'ok', usageMetadata: undefined });
  (client as any).client = { models: { generateContent } };
  return { client, generateContent };
}

describe('Gemini options.system delivery', () => {
  it('invokeWithUsage → systemInstruction in the request config', async () => {
    const { client, generateContent } = makeGeminiClient();
    await client.invokeWithUsage(USER_MSG as any, { system: SYSTEM });
    const payload = generateContent.mock.calls[0][0];
    expect(payload.config.systemInstruction).toBe(SYSTEM);
  });

  it('no options.system → no systemInstruction', async () => {
    const { client, generateContent } = makeGeminiClient();
    await client.invokeWithUsage(USER_MSG as any, {});
    const payload = generateContent.mock.calls[0][0];
    expect(payload.config.systemInstruction).toBeUndefined();
  });
});

// ─── OpenAI Responses API ───────────────────────────────────────────────────

function makeResponsesClient(): { client: OpenAIResponsesLLMClient; create: ReturnType<typeof vi.fn> } {
  const client = new OpenAIResponsesLLMClient(undefined, {
    apiKey: 'test-key',
    modelName: 'gpt-5.6-terra',
    provider: 'openai',
  });
  const create = vi.fn().mockResolvedValue({ output: [], usage: undefined });
  (client as any).client = { responses: { create } };
  return { client, create };
}

describe('OpenAI Responses options.system delivery', () => {
  it('invokeWithUsage → system role present in input', async () => {
    const { client, create } = makeResponsesClient();
    await client.invokeWithUsage(USER_MSG as any, { system: SYSTEM });
    const payload = create.mock.calls[0][0];
    const systemItems = (payload.input as any[]).filter((i) => i.role === 'system');
    expect(systemItems).toHaveLength(1);
    expect(JSON.stringify(systemItems[0])).toContain(SYSTEM);
  });

  it('no options.system → no system role in input', async () => {
    const { client, create } = makeResponsesClient();
    await client.invokeWithUsage(USER_MSG as any, {});
    const payload = create.mock.calls[0][0];
    expect((payload.input as any[]).some((i) => i.role === 'system')).toBe(false);
  });
});
