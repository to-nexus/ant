/**
 * OpenAI Responses reasoning-item envelope.
 *
 * The Responses API keeps a turn's chain-of-thought in `reasoning` output items
 * whose payload is encrypted (`encrypted_content`, returned only when the
 * request opts in via `include: ['reasoning.encrypted_content']`). To preserve
 * reasoning ACROSS tool-call rounds those items must be replayed verbatim as
 * input items on the next request — otherwise the model re-derives its plan
 * every round.
 *
 * ANT's conversation history speaks {@link ThinkingContentBlock}, whose
 * `signature` field is defined as the opaque provider token needed to replay a
 * thinking block on a later turn — exactly this role for Anthropic. Encoding
 * the reasoning items into that same field means the whole history pipeline
 * (`callLLMWithToolLoop`, `buildAssistantMessage`, the six per-node thinking
 * accumulators, and the three checkpoint state shapes) carries reasoning
 * continuity with zero changes: they already persist `signature` verbatim.
 *
 * The prefix makes the encoding self-identifying, so a conversation whose model
 * was switched mid-flight never feeds one provider's token to another.
 */

/** Marks a signature string as an OpenAI reasoning envelope rather than an Anthropic signature. */
export const REASONING_ENVELOPE_PREFIX = 'ant-oai-reasoning:v1:';

/**
 * Cap on the encoded envelope. Encrypted reasoning payloads run a few KB each
 * and the envelope is persisted into job checkpoints, so an unbounded round
 * would bloat every resume. On overflow the OLDEST items are dropped: the most
 * recent reasoning is the part the next round actually continues from.
 */
export const REASONING_ENVELOPE_MAX_BYTES = 256 * 1024;

export interface ReasoningItemRef {
  /** Responses item id (`rs_…`). */
  id: string;
  /** `encrypted_content`, present when the request included `reasoning.encrypted_content`. */
  encryptedContent?: string;
}

/** Whether a thinking-block signature belongs to another provider's scheme. */
export function isReasoningEnvelope(signature: string | undefined): boolean {
  return !!signature && signature.startsWith(REASONING_ENVELOPE_PREFIX);
}

/**
 * Encode a round's reasoning items into a signature string, dropping the
 * oldest items until the result fits {@link REASONING_ENVELOPE_MAX_BYTES}.
 * Returns `undefined` when there is nothing (left) to carry.
 */
export function encodeReasoningEnvelope(items: ReasoningItemRef[]): string | undefined {
  let kept = items.filter((it) => it.id);
  while (kept.length > 0) {
    const encoded =
      REASONING_ENVELOPE_PREFIX +
      Buffer.from(JSON.stringify(kept), 'utf8').toString('base64');
    if (Buffer.byteLength(encoded, 'utf8') <= REASONING_ENVELOPE_MAX_BYTES) return encoded;
    kept = kept.slice(1);
  }
  return undefined;
}

/**
 * Decode a signature string back into reasoning items. Anything that is not an
 * envelope (an Anthropic signature, an empty string, corrupted base64) yields
 * an empty array — a lost replay degrades quality, a throw would kill the job.
 */
export function decodeReasoningEnvelope(signature: string | undefined): ReasoningItemRef[] {
  if (!isReasoningEnvelope(signature)) return [];
  try {
    const json = Buffer.from(
      signature!.slice(REASONING_ENVELOPE_PREFIX.length),
      'base64',
    ).toString('utf8');
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((it): it is ReasoningItemRef => !!it && typeof it.id === 'string');
  } catch {
    console.warn('[reasoningEnvelope] Failed to decode reasoning envelope — replaying without it');
    return [];
  }
}
