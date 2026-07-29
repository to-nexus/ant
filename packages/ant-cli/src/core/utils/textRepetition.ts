/**
 * Text-repetition primitives — single owner (D: no FNV-1a duplicates).
 *
 * Consumers:
 *  - `agents/architect/graph/code/nodes/execute/drainFinalize.ts` — repeated
 *    assistant-text ring (vivid-orbiting-dodge RCA)
 *  - `agents/common/llm/callLLMWithToolLoop.ts` — in-stream degeneration
 *    breaker (sage-causing-rover RCA)
 */

export function normalizeAssistantText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** FNV-1a 32-bit — non-crypto; a collision merely risks one spurious +1 in a
 * streak that needs several consecutive hits to act. */
export function hashText(normalized: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Incremental degenerate-repetition detector for streaming text.
 *
 * Feed text deltas; the tracker splits on sentence/line boundaries and counts
 * consecutive units whose hash re-occurs within a small ring of recent unit
 * hashes — the ring (size 3, mirroring drainFinalize's
 * `RECENT_TEXT_RING_SIZE`) catches both the locked single-sentence loop
 * ("Let me read the update method." × 325 — sage-causing-rover) and the
 * A/B-alternating pattern (vivid-orbiting-dodge). Trips only when all hold:
 *   - the repeated unit is ≥ `minUnitLength` chars (table rows / list bullets
 *     like `| --- |` or `- none` never qualify),
 *   - ring-repeats accumulated ≥ `threshold` consecutively,
 *   - total observed text is ≥ `minTotalChars` (short legitimate emphasis
 *     never trips).
 * Trips within a handful of sentences instead of 8K tokens.
 */
export class StreamRepetitionTracker {
  private buffer = '';
  private totalChars = 0;
  private recentHashes: string[] = [];
  private streak = 0;
  private trippedFlag = false;

  constructor(
    private readonly threshold = 4,
    private readonly minUnitLength = 20,
    private readonly minTotalChars = 400,
    private readonly ringSize = 3,
  ) {}

  /** Feed a text delta. Returns true once the tracker has tripped. */
  push(delta: string): boolean {
    if (this.trippedFlag) return true;
    this.totalChars += delta.length;
    this.buffer += delta;

    // Complete units end at sentence punctuation followed by whitespace, or
    // at newlines. Keep the trailing incomplete fragment in the buffer.
    const parts = this.buffer.split(/(?<=[.!?])\s+|\n+/);
    this.buffer = parts.pop() ?? '';
    for (const part of parts) {
      this.observe(part);
      if (this.trippedFlag) return true;
    }
    return false;
  }

  /** Reset all state (provider retry replays the round from scratch). */
  reset(): void {
    this.buffer = '';
    this.totalChars = 0;
    this.recentHashes = [];
    this.streak = 0;
    this.trippedFlag = false;
  }

  get tripped(): boolean {
    return this.trippedFlag;
  }

  private observe(unit: string): void {
    const normalized = normalizeAssistantText(unit);
    if (normalized.length < this.minUnitLength) {
      // Short units break the streak — they are not evidence of the loop,
      // and counting them as neutral would let `A. -. A. -.` alternations
      // accumulate a false streak.
      this.recentHashes = [];
      this.streak = 0;
      return;
    }
    const h = hashText(normalized);
    if (this.recentHashes.includes(h)) {
      this.streak += 1;
    } else {
      this.streak = 0;
    }
    this.recentHashes = [...this.recentHashes, h].slice(-this.ringSize);
    if (this.streak >= this.threshold && this.totalChars >= this.minTotalChars) {
      this.trippedFlag = true;
    }
  }
}
