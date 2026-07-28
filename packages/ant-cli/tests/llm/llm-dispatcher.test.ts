/**
 * Transport-level liveness dispatcher (sandy-loading-coral 2nd RCA).
 *
 * Liveness is decided at the byte layer: a shared undici Agent with
 * headersTimeout/bodyTimeout + TCP keepalive, attached to BOTH SDK clients via
 * fetchOptions.dispatcher. Provider keepalives (Anthropic `ping`, SSE `:`
 * comments) reset the byte timer but are invisible to the parsed-event layer —
 * so this dispatcher is the only keepalive-aware timer in the stack.
 */

import { describe, it, expect } from 'vitest';
import { Agent } from 'undici';
import { getLLMDispatcher } from '../../src/periphery/adapters/llm/llmDispatcher';
import { OpenAILLMClient } from '../../src/periphery/adapters/llm/OpenAILLMClient';
import { AnthropicLLMClient } from '../../src/periphery/adapters/llm/AnthropicLLMClient';

describe('getLLMDispatcher', () => {
  it('returns a singleton undici Agent (shared connection pool)', () => {
    const a = getLLMDispatcher();
    const b = getLLMDispatcher();
    expect(a).toBeInstanceOf(Agent);
    expect(b).toBe(a);
  });

  it('OpenAI-compat client carries the dispatcher in fetchOptions', () => {
    const client = new OpenAILLMClient(undefined, {
      apiKey: 'test-key',
      modelName: 'glm-5.2',
      provider: 'glm',
    });
    const sdk = (client as any).client;
    expect(sdk.fetchOptions?.dispatcher).toBe(getLLMDispatcher());
  });

  it('Anthropic client carries the dispatcher in fetchOptions', () => {
    const client = new AnthropicLLMClient(undefined, {
      apiKey: 'test-key',
      modelName: 'claude-sonnet-5',
    });
    const sdk = (client as any).client;
    expect(sdk.fetchOptions?.dispatcher).toBe(getLLMDispatcher());
  });
});
