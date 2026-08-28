/**
 * GLM (Zhipu / Z.ai) provider wiring guard.
 *
 * GLM is OpenAI-compatible, so it reuses OpenAILLMClient with an injected
 * baseURL/provider (LLMClientFactory), exactly like DeepSeek. This locks:
 *   - factory prefix detection (glm-* → 'glm')
 *   - the OpenAILLMClient provider tag round-trips as 'glm'
 *   - the registry-derived pricing + context maps resolve (no strict-throw)
 *   - the data-consent gate covers GLM
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeCallCostUsd,
  getModelContextWindow,
  providerRequiresDataConsent,
  MODEL_REGISTRY,
} from '@ant/shared';
import { detectProviderFromModel } from '../../src/periphery/adapters/llm/LLMClientFactory';
import { OpenAILLMClient } from '../../src/periphery/adapters/llm/OpenAILLMClient';

describe('GLM provider wiring', () => {
  it('detects the glm provider from the model-name prefix', () => {
    expect(detectProviderFromModel('glm-5.2')).toBe('glm');
    expect(detectProviderFromModel('glm-4.7')).toBe('glm');
    expect(detectProviderFromModel('GLM-5.2')).toBe('glm'); // case-insensitive
  });

  it('round-trips the injected glm provider tag on OpenAILLMClient', () => {
    const client = new OpenAILLMClient(undefined, {
      apiKey: 'test-key',
      modelName: 'glm-5.2',
      provider: 'glm',
    });
    expect(client.provider).toBe('glm');
    expect(client.modelName).toBe('glm-5.2');
  });

  it('registers both tiers with provider glm and selectable', () => {
    for (const id of ['glm-5.2', 'glm-4.7'] as const) {
      const spec = MODEL_REGISTRY[id];
      expect(spec).toBeTruthy();
      expect(spec.provider).toBe('glm');
      expect(spec.selectable).toBe(true);
      // Non-Anthropic: must never carry Anthropic thinking params.
      expect(spec.thinkingMode).toBe('none');
    }
  });

  it('resolves registry-derived pricing without UnknownModelRateError', () => {
    const cost = computeCallCostUsd('glm-5.2', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    // 1M in @ $1.4 + 1M out @ $4.4 = $5.8
    expect(cost).toBeCloseTo(5.8, 6);
  });

  it('resolves registry-derived context windows (strict, no throw)', () => {
    expect(getModelContextWindow('glm-5.2')).toBe(1_000_000);
    expect(getModelContextWindow('glm-4.7')).toBe(200_000);
  });

  it('gates GLM behind the third-party data-consent notice', () => {
    expect(providerRequiresDataConsent('glm')).toBe(true);
    expect(providerRequiresDataConsent('deepseek')).toBe(true);
    expect(providerRequiresDataConsent('anthropic')).toBe(false);
    expect(providerRequiresDataConsent(undefined)).toBe(false);
  });
});

/**
 * Per-round thinking-toggle parity (empty-calming-alder RCA).
 *
 * The tool-loop passes `enableThinking` per round (ON round 1 / OFF after tool
 * calls). AnthropicLLMClient honors it; OpenAILLMClient must honor it for
 * hard-toggle providers (GLM / DeepSeek) too — else GLM reasons on every
 * action round, ballooning output into the max_tokens ceiling. Precedence:
 * the provider *_THINKING=disabled env is an operator hard opt-out that wins.
 */
describe('OpenAI-compat thinking toggle (parity with AnthropicLLMClient)', () => {
  const ORIGINAL_GLM_THINKING = process.env.GLM_THINKING;

  afterEach(() => {
    if (ORIGINAL_GLM_THINKING === undefined) delete process.env.GLM_THINKING;
    else process.env.GLM_THINKING = ORIGINAL_GLM_THINKING;
    vi.restoreAllMocks();
  });

  /** Drive `stream(...)` and return the payload passed to chat.completions.create. */
  async function captureCreatePayload(
    provider: string,
    options: Record<string, any>,
  ): Promise<any> {
    const client = new OpenAILLMClient(undefined, {
      apiKey: 'test-key',
      modelName: provider === 'openai' ? 'gpt-4o' : `${provider}-5.2`,
      provider,
    });
    const create = vi
      .fn()
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      .mockImplementation(async () => (async function* () {})());
    // Reach the injected OpenAI SDK instance on the private field.
    (client as any).client = { chat: { completions: { create } } };

    const messages = [{ role: 'user', content: 'hi' }];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.stream(messages as any, options)) {
      /* drain */
    }
    expect(create).toHaveBeenCalledTimes(1);
    return create.mock.calls[0][0];
  }

  it('GLM: enableThinking=false → thinking.type=disabled', async () => {
    delete process.env.GLM_THINKING;
    const payload = await captureCreatePayload('glm', { enableThinking: false });
    expect(payload.thinking).toEqual({ type: 'disabled' });
  });

  it('GLM: enableThinking=true (or omitted) → thinking.type=enabled', async () => {
    delete process.env.GLM_THINKING;
    const enabled = await captureCreatePayload('glm', { enableThinking: true });
    expect(enabled.thinking).toEqual({ type: 'enabled' });
    const omitted = await captureCreatePayload('glm', {});
    expect(omitted.thinking).toEqual({ type: 'enabled' });
  });

  it('GLM: GLM_THINKING=disabled env wins over the per-round toggle', async () => {
    process.env.GLM_THINKING = 'disabled';
    const payload = await captureCreatePayload('glm', { enableThinking: true });
    expect(payload.thinking).toEqual({ type: 'disabled' });
  });

  it('DeepSeek: honors the per-round toggle (THINKING_TOGGLE_PROVIDERS generalization)', async () => {
    const payload = await captureCreatePayload('deepseek', { enableThinking: false });
    expect(payload.thinking).toEqual({ type: 'disabled' });
  });

  it('real OpenAI: never attaches a thinking param (would 400)', async () => {
    const payload = await captureCreatePayload('openai', { enableThinking: false });
    expect(payload.thinking).toBeUndefined();
  });

  it('GLM: thinkingBudget is NOT a channel — no budget field reaches the request', async () => {
    // metal-killing-crowd RCA: hard-toggle providers accept only
    // `thinking:{type}` — a caller-passed thinkingBudget is silently dropped,
    // so reasoning shares the single max_tokens budget. The round's output
    // cap is therefore the ONLY thinking bound on GLM/DeepSeek; callers must
    // never assume the budget binds here.
    delete process.env.GLM_THINKING;
    const payload = await captureCreatePayload('glm', {
      enableThinking: true,
      thinkingBudget: 10_000,
      maxTokens: 16_000,
    });
    expect(payload.thinking).toEqual({ type: 'enabled' });
    expect(payload.thinking.budget_tokens).toBeUndefined();
    expect(payload.thinking_budget).toBeUndefined();
    expect(payload.thinkingBudget).toBeUndefined();
    expect(payload.max_tokens).toBe(16_000);
  });

  /**
   * Sampling parity (jade-hiking-penny RCA): the client temperature applies
   * ONLY to non-thinking rounds — the same invariant AnthropicLLMClient
   * enforces via buildSamplingParams. On hard-toggle providers reasoning
   * shares the completion decode stream, and both vendors document low
   * temperature as an endless-repetition pathology (DeepSeek-R1: 0.5–0.7
   * mandated; GLM-4.6 card: 1.0). Thinking rounds omit temperature so the
   * provider default applies; non-thinking rounds keep the SSOT value.
   */
  it('GLM: thinking round OMITS temperature (provider default samples the reasoning)', async () => {
    delete process.env.GLM_THINKING;
    const enabled = await captureCreatePayload('glm', { enableThinking: true, temperature: 0.3 });
    expect(enabled.thinking).toEqual({ type: 'enabled' });
    expect(enabled.temperature).toBeUndefined();
    const omitted = await captureCreatePayload('glm', { temperature: 0.3 });
    expect(omitted.temperature).toBeUndefined();
  });

  it('GLM: non-thinking round keeps the SSOT temperature', async () => {
    delete process.env.GLM_THINKING;
    const payload = await captureCreatePayload('glm', { enableThinking: false, temperature: 0.3 });
    expect(payload.thinking).toEqual({ type: 'disabled' });
    expect(payload.temperature).toBe(0.3);
  });

  it('GLM: GLM_THINKING=disabled env → thinking off, temperature flows', async () => {
    process.env.GLM_THINKING = 'disabled';
    const payload = await captureCreatePayload('glm', { enableThinking: true, temperature: 0.2 });
    expect(payload.thinking).toEqual({ type: 'disabled' });
    expect(payload.temperature).toBe(0.2);
  });

  it('DeepSeek: same thinking-round temperature omission (generalization)', async () => {
    const on = await captureCreatePayload('deepseek', { enableThinking: true, temperature: 0.2 });
    expect(on.temperature).toBeUndefined();
    const off = await captureCreatePayload('deepseek', { enableThinking: false, temperature: 0.2 });
    expect(off.temperature).toBe(0.2);
  });

  it('real OpenAI: temperature always flows (no thinking param universe)', async () => {
    const payload = await captureCreatePayload('openai', { enableThinking: true, temperature: 0.3 });
    expect(payload.thinking).toBeUndefined();
    expect(payload.temperature).toBe(0.3);
  });

  it('GLM non-streaming (invokeWithUsage): same omission on thinking rounds', async () => {
    delete process.env.GLM_THINKING;
    const on = await captureInvokePayload('glm', { enableThinking: true, temperature: 0.3 });
    expect(on.temperature).toBeUndefined();
    const off = await captureInvokePayload('glm', { enableThinking: false, temperature: 0.3 });
    expect(off.temperature).toBe(0.3);
  });

  /** Drive the non-streaming `invokeWithUsage` and capture the create payload. */
  async function captureInvokePayload(
    provider: string,
    options: Record<string, any>,
  ): Promise<any> {
    const client = new OpenAILLMClient(undefined, {
      apiKey: 'test-key',
      modelName: provider === 'openai' ? 'gpt-4o' : `${provider}-5.2`,
      provider,
    });
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    (client as any).client = { chat: { completions: { create } } };

    await client.invokeWithUsage([{ role: 'user', content: 'hi' }] as any, options);
    expect(create).toHaveBeenCalledTimes(1);
    return create.mock.calls[0][0];
  }

  it('GLM non-streaming (invokeWithUsage): honors enableThinking', async () => {
    delete process.env.GLM_THINKING;
    expect((await captureInvokePayload('glm', { enableThinking: false })).thinking).toEqual({ type: 'disabled' });
    expect((await captureInvokePayload('glm', { enableThinking: true })).thinking).toEqual({ type: 'enabled' });
    expect((await captureInvokePayload('glm', {})).thinking).toEqual({ type: 'enabled' });
  });

  it('GLM non-streaming: GLM_THINKING=disabled env wins', async () => {
    process.env.GLM_THINKING = 'disabled';
    expect((await captureInvokePayload('glm', { enableThinking: true })).thinking).toEqual({ type: 'disabled' });
  });

  it('real OpenAI non-streaming: no thinking param', async () => {
    expect((await captureInvokePayload('openai', { enableThinking: false })).thinking).toBeUndefined();
  });
});

/**
 * Cooperative-cancellation forwarding (gentle-leaping-lathe RCA).
 *
 * OpenAILLMClient historically dropped `options.signal`, so a user stop
 * could not sever an in-flight GLM stream — a runaway generation ran until
 * the process was SIGTERM'd. The signal must reach the SDK request options,
 * and an already-aborted job must not open a fresh stream at all.
 */
describe('OpenAILLMClient — abort-signal forwarding (stream)', () => {
  afterEach(() => vi.restoreAllMocks());

  function makeClientWithCreateSpy() {
    const client = new OpenAILLMClient(undefined, {
      apiKey: 'test-key',
      modelName: 'glm-5.2',
      provider: 'glm',
    });
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const create = vi.fn().mockImplementation(async () => (async function* () {})());
    (client as any).client = { chat: { completions: { create } } };
    return { client, create };
  }

  it('forwards options.signal to chat.completions.create request options', async () => {
    const { client, create } = makeClientWithCreateSpy();
    const controller = new AbortController();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.stream(
      [{ role: 'user', content: 'hi' }] as any,
      { enableThinking: false, signal: controller.signal },
    )) {
      /* drain */
    }
    expect(create).toHaveBeenCalledTimes(1);
    // Second positional arg is the SDK request-options object. Since the
    // per-attempt watchdog controller (streamAttemptWithIdleAbort), the SDK
    // receives a COMBINED signal (AbortSignal.any([caller, attempt])), so we
    // assert behavior — caller abort propagates — not identity.
    const passed = create.mock.calls[0][1]?.signal as AbortSignal;
    expect(passed).toBeInstanceOf(AbortSignal);
    expect(passed.aborted).toBe(false);
    controller.abort();
    expect(passed.aborted).toBe(true);
  });

  it('does NOT open a stream when the signal is already aborted (between-round stop)', async () => {
    const { client, create } = makeClientWithCreateSpy();
    const controller = new AbortController();
    controller.abort();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client.stream(
      [{ role: 'user', content: 'hi' }] as any,
      { enableThinking: false, signal: controller.signal },
    )) {
      /* drain */
    }
    expect(create).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// marble-curling-clasp RCA — GLM's text tool-call markup leaked into the
// structured channel: the ENTIRE payload arrived inside function.name
// (`plan</arg_key><arg_value>{…17KB…}</arg_value>`) with empty arguments,
// and the ghost call silently dropped a sealed plan. salvageMarkupToolCall
// re-splits such names at the ingestion boundary.
// ─────────────────────────────────────────────────────────────────────
import { salvageMarkupToolCall } from '../../src/periphery/adapters/llm/toolCallMarkupSalvage';

describe('salvageMarkupToolCall — GLM markup leak (marble-curling-clasp RCA)', () => {
  it('passes clean names through untouched', () => {
    const r = salvageMarkupToolCall('read_file');
    expect(r).toEqual({ name: 'read_file', input: null, malformed: false });
  });

  it('recovers the marble shape: name + dangling </arg_key> + one JSON-object value', () => {
    const payload = { task: { id: 'x' }, candidateSolutions: [1, 2, 3] };
    const raw = `plan</arg_key><arg_value>${JSON.stringify(payload)}</arg_value>`;
    const r = salvageMarkupToolCall(raw);
    expect(r.malformed).toBe(true);
    expect(r.name).toBe('plan');
    expect(r.input).toEqual(payload);
  });

  it('recovers well-formed key/value pairs leaked into the name', () => {
    const raw = 'read_file<arg_key>path</arg_key><arg_value>codebase/a.ts</arg_value>' +
      '<arg_key>startLine</arg_key><arg_value>10</arg_value>';
    const r = salvageMarkupToolCall(raw);
    expect(r.malformed).toBe(true);
    expect(r.name).toBe('read_file');
    expect(r.input).toEqual({ path: 'codebase/a.ts', startLine: 10 });
  });

  it('recovers the name but not args for a non-object lone value (no guessing)', () => {
    const r = salvageMarkupToolCall('read_file</arg_key><arg_value>codebase/a.ts</arg_value>');
    expect(r.malformed).toBe(true);
    expect(r.name).toBe('read_file');
    expect(r.input).toBeNull();
  });

  it('keeps the raw name when nothing usable precedes the markup (loud unknown-tool failure)', () => {
    const raw = '<arg_key>plan</arg_key><arg_value>{}</arg_value>';
    const r = salvageMarkupToolCall(raw);
    expect(r.malformed).toBe(true);
    expect(r.name).toBe(raw);
    expect(r.input).toBeNull();
  });

  it('strips a trailing tool_call closer from the salvaged segments', () => {
    const raw = 'plan</arg_key><arg_value>{"a":1}</arg_value></tool_call>';
    const r = salvageMarkupToolCall(raw);
    expect(r.name).toBe('plan');
    expect(r.input).toEqual({ a: 1 });
  });
});
