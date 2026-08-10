/**
 * sanitizeMessages — provider-neutral empty-content guard for LLM messages.
 *
 * Empty (or whitespace-only) text blocks are junk in the neutral message
 * format: Anthropic hard-rejects them (`400 messages: text content blocks
 * must be non-empty`), while OpenAI/Gemini tolerate them but carry the same
 * meaningless payload. Because ANT is a model-neutral framework (per-model
 * adapters with no shared base class), this single helper is invoked at the
 * input boundary of every adapter's message conversion so the guarantee holds
 * for every provider AND every call path — including LLM calls that bypass the
 * shared `composeMessages` (direct / decompose / structured).
 *
 * Rules:
 *  - Drop `type:'text'` blocks whose text is empty/whitespace-only.
 *  - Preserve all non-text blocks (`tool_use`, `tool_result`, `image`,
 *    `thinking`) untouched — an assistant message carrying only a `tool_use`
 *    block is valid and must not be coerced.
 *  - If a message ends up with no blocks at all (it was purely empty text),
 *    substitute a single minimal placeholder text block so the message stays
 *    present and non-empty (preserves role structure/alternation for every
 *    provider; never emit an empty `content: []`).
 *  - Empty/whitespace string content → same placeholder coercion.
 *
 * The caller's arrays are never mutated: unchanged messages are returned by
 * reference, changed messages are shallow-cloned.
 */

import type { MessageContentBlock, CacheableContent } from '../ports/llm';

/** Non-empty stand-in for a message that would otherwise carry no content. */
export const EMPTY_CONTENT_PLACEHOLDER = '(no content)';

type NeutralContent = string | MessageContentBlock[] | CacheableContent[];
type NeutralMessage = { role: string; content: NeutralContent };

function isBlankText(text: string | undefined): boolean {
  return !text || text.trim().length === 0;
}

/**
 * Return a copy of `messages` with every empty text block removed and any
 * emptied message backfilled with a placeholder. Structure-preserving and
 * non-mutating.
 */
export function sanitizeMessages<T extends NeutralMessage>(messages: T[]): T[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return isBlankText(msg.content)
        ? { ...msg, content: EMPTY_CONTENT_PLACEHOLDER }
        : msg;
    }

    const blocks = msg.content as MessageContentBlock[];
    const filtered = blocks.filter(
      (b) => !(b.type === 'text' && isBlankText((b as { text?: string }).text)),
    );

    if (filtered.length === blocks.length) return msg; // no empty text blocks

    if (filtered.length === 0) {
      return {
        ...msg,
        content: [{ type: 'text', text: EMPTY_CONTENT_PLACEHOLDER }] as MessageContentBlock[],
      };
    }

    return { ...msg, content: filtered };
  });
}

/**
 * Materialize the port-level `options.system` contract into the neutral
 * message list. `options.system` is a cross-adapter contract (see
 * `core/ports/llm.ts`): AnthropicLLMClient maps it to the API's `system`
 * param natively; every other adapter carries system content as a
 * `role:'system'` message, and MUST route through this helper so the option
 * is never silently dropped (jade-blessing-brass RCA: the OpenAI-compat
 * adapter ignored it, so GLM never received any system prompt).
 *
 * Semantics mirror Anthropic's priority rule — `options.system` WINS over
 * message-embedded system roles: when `system` is non-blank, existing
 * `role:'system'` messages are removed and a single system message is
 * prepended. When `system` is absent/blank, messages pass through untouched.
 * Non-mutating.
 */
export function applySystemOption<T extends NeutralMessage>(
  messages: T[],
  system: string | undefined,
): T[] {
  if (isBlankText(system)) return messages;
  const withoutSystem = messages.filter((m) => m.role !== 'system');
  return [{ role: 'system', content: system as string } as T, ...withoutSystem];
}
