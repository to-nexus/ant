/**
 * sanitizeMessages — provider-neutral empty-content guard.
 *
 * Locks the fix for the `navy-choosing-ingot` incident: a clarify-pause turn
 * saved with empty content became `{role:'assistant', content:[{type:'text',
 * text:''}]}` and, on resume, was replayed to Anthropic → `400 messages: text
 * content blocks must be non-empty`. Empty text blocks are junk on every
 * provider, so the guard is shared and applied at every adapter boundary.
 *
 * This suite tests the helper directly (provider-independent) plus a per-adapter
 * smoke asserting each adapter's message conversion no longer emits an empty
 * text block.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeMessages,
  EMPTY_CONTENT_PLACEHOLDER,
} from '../../src/core/utils/sanitizeMessages';
import { AnthropicLLMClient } from '../../src/periphery/adapters/llm/AnthropicLLMClient';
import { OpenAILLMClient } from '../../src/periphery/adapters/llm/OpenAILLMClient';
import { GeminiLLMClient } from '../../src/periphery/adapters/llm/GeminiLLMClient';
import type { MessageContentBlock } from '../../src/core/ports/llm';

type Msg = { role: string; content: string | MessageContentBlock[] };

const clarifyResumeHistory = (): Msg[] => [
  { role: 'user', content: [{ type: 'text', text: 'original request' }] },
  { role: 'assistant', content: [{ type: 'text', text: '' }] }, // the poison turn
  { role: 'user', content: [{ type: 'text', text: 'clarify answers' }] },
];

const hasEmptyTextBlock = (content: any): boolean =>
  Array.isArray(content) &&
  content.some((b: any) => b?.type === 'text' && (!b.text || b.text.trim().length === 0));

describe('sanitizeMessages (shared helper)', () => {
  it('drops an empty text block and backfills a non-empty placeholder', () => {
    const out = sanitizeMessages(clarifyResumeHistory());
    expect(out).toHaveLength(3);
    const assistant = out[1];
    expect(Array.isArray(assistant.content)).toBe(true);
    expect((assistant.content as any[]).length).toBe(1);
    expect((assistant.content as any[])[0]).toEqual({
      type: 'text',
      text: EMPTY_CONTENT_PLACEHOLDER,
    });
    expect(hasEmptyTextBlock(assistant.content)).toBe(false);
  });

  it('preserves a tool_use block and only removes the empty text sibling', () => {
    const out = sanitizeMessages<Msg>([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '   ' }, // whitespace-only → dropped
          { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a.ts' } },
        ],
      },
    ]);
    const blocks = out[0].content as any[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('tool_use');
  });

  it('coerces empty/whitespace string content to the placeholder', () => {
    const out = sanitizeMessages<Msg>([{ role: 'assistant', content: '  ' }]);
    expect(out[0].content).toBe(EMPTY_CONTENT_PLACEHOLDER);
  });

  it('returns non-empty messages by reference (no needless cloning)', () => {
    const input: Msg[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    const out = sanitizeMessages(input);
    expect(out[0]).toBe(input[0]);
  });
});

describe('adapters never emit an empty text block (parity across providers)', () => {
  it('Anthropic convertMessages', () => {
    const client = new AnthropicLLMClient(undefined, { apiKey: 'k', modelName: 'claude-sonnet-5' });
    const converted = (client as any).convertMessages(clarifyResumeHistory());
    for (const m of converted) expect(hasEmptyTextBlock(m.content)).toBe(false);
  });

  it('OpenAI convertToOpenAIMessages', () => {
    const client = new OpenAILLMClient(undefined, { apiKey: 'k', modelName: 'gpt-4o' });
    const converted = (client as any).convertToOpenAIMessages(clarifyResumeHistory());
    for (const m of converted) expect(hasEmptyTextBlock(m.content)).toBe(false);
  });

  it('Gemini convertMessages', () => {
    const client = new GeminiLLMClient(undefined, { apiKey: 'k', modelName: 'gemini-2.5-pro' });
    const { contents } = (client as any).convertMessages(clarifyResumeHistory());
    for (const c of contents) {
      const emptyPart = (c.parts || []).some(
        (p: any) => typeof p?.text === 'string' && p.text.trim().length === 0,
      );
      expect(emptyPart).toBe(false);
    }
  });
});
