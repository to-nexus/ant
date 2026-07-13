/**
 * AnthropicLLMClient — provider cache-breakpoint mechanics guard.
 *
 * Anthropic prompt caching needs an EXPLICIT `cache_control` marker on each
 * cached span (unlike DeepSeek/OpenAI auto-prefix-caching). Callers only mark
 * the static turn-1 prefix, so across a growing tool-loop the accumulated
 * history was never cached under Anthropic models — cacheRead frozen while
 * billable input climbed every round (prime-nesting-grate RCA: 46-min /
 * 6.5M-token plan phase). `applyProviderCacheBreakpoints` fixes this at the
 * single wire chokepoint by placing a rolling tail marker + capping ≤4.
 *
 * Locks: rolling tail on multi-round history, single-shot NOT marked,
 * string-tail wrapping, ≤4 cap (keep first 3 + tail), and no caller mutation
 * (convertMessages clones before the marker lands).
 */

import { describe, it, expect } from 'vitest';
import { AnthropicLLMClient } from '../../src/periphery/adapters/llm/AnthropicLLMClient';
import type { MessageContentBlock } from '../../src/core/ports/llm';

function makeClient(): AnthropicLLMClient {
  return new AnthropicLLMClient(undefined, { apiKey: 'test-key', modelName: 'claude-sonnet-5' });
}

// applyProviderCacheBreakpoints + convertMessages are private; access via cast.
function normalize(client: AnthropicLLMClient, systemParam: any, messages: any[]): void {
  (client as any).applyProviderCacheBreakpoints(systemParam, messages);
}
function convert(client: AnthropicLLMClient, messages: any[]): any[] {
  return (client as any).convertMessages(messages);
}

const hasCache = (block: any) => Boolean(block?.cache_control);

describe('AnthropicLLMClient cache breakpoints', () => {
  it('adds a rolling tail marker on the last block of a multi-round history', () => {
    const client = makeClient();
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'prompt', cache_control: { type: 'ephemeral' } }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'read_file', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'file body' }] },
    ];

    normalize(client, undefined, messages);

    // Rolling tail on the trailing tool_result.
    expect(hasCache(messages[2].content[0])).toBe(true);
    // Static prefix marker preserved.
    expect(hasCache(messages[0].content[0])).toBe(true);
  });

  it('does NOT mark a single-shot call (no history to read the write back)', () => {
    const client = makeClient();
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'one-shot question' }] },
    ];

    normalize(client, undefined, messages);

    expect(hasCache(messages[0].content[0])).toBe(false);
  });

  it('wraps a trailing string message into a cached text block', () => {
    const client = makeClient();
    const messages: any[] = [
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      { role: 'user', content: 'Continue.' },
    ];

    normalize(client, undefined, messages);

    expect(Array.isArray(messages[2].content)).toBe(true);
    expect(messages[2].content[0]).toMatchObject({ type: 'text', text: 'Continue.' });
    expect(hasCache(messages[2].content[0])).toBe(true);
  });

  it('caps total breakpoints at 4 — keeps the first 3 stable-prefix markers + rolling tail', () => {
    const client = makeClient();
    const cc = () => ({ type: 'ephemeral' as const });
    // 2 system markers + 3 marked message blocks (last is the eventual tail) = 5 → cap to 4.
    const systemParam = [
      { type: 'text', text: 'sys1', cache_control: cc() },
      { type: 'text', text: 'sys2', cache_control: cc() },
    ];
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'ctx', cache_control: cc() }] },
      { role: 'assistant', content: [{ type: 'text', text: 'mid', cache_control: cc() }] },
      { role: 'user', content: [{ type: 'text', text: 'tail' }] },
    ];

    normalize(client, systemParam, messages);

    // Rolling tail added → block gets a marker.
    expect(hasCache(messages[2].content[0])).toBe(true);

    // Collect markers in wire order: sys1, sys2, ctx, mid(?), tail.
    const wireOrder = [
      systemParam[0], systemParam[1],
      messages[0].content[0], messages[1].content[0], messages[2].content[0],
    ];
    const kept = wireOrder.filter(hasCache);
    expect(kept.length).toBe(4);
    // First 3 (sys1, sys2, ctx) + tail kept; the middle 'mid' marker stripped.
    expect(hasCache(systemParam[0])).toBe(true);
    expect(hasCache(systemParam[1])).toBe(true);
    expect(hasCache(messages[0].content[0])).toBe(true);
    expect(hasCache(messages[1].content[0])).toBe(false);
    expect(hasCache(messages[2].content[0])).toBe(true);
  });

  it('does not mutate the caller message blocks (convertMessages clones first)', () => {
    const client = makeClient();
    const callerToolResult = { type: 'tool_result', tool_use_id: 'c1', content: 'file body' } as any;
    const caller: Array<{ role: string; content: string | MessageContentBlock[] }> = [
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'read_file', input: {} } as any] },
      { role: 'user', content: [callerToolResult] },
    ];

    // Production path: convert (clone) → normalize the clone.
    const converted = convert(client, caller);
    normalize(client, undefined, converted);

    // Clone carries the tail marker...
    const lastConverted = converted[converted.length - 1].content;
    expect(hasCache(lastConverted[lastConverted.length - 1])).toBe(true);
    // ...but the caller's original block is untouched.
    expect(hasCache(callerToolResult)).toBe(false);
  });
});
