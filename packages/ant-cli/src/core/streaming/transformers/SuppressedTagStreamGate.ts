/**
 * SuppressedTagStreamGate — makes `consumed-suppressed` suppression
 * independent of chunk boundaries.
 *
 * `SpecialTagTransformer.transform()` is single-shot per chunk: it only
 * suppresses a tag whose opening AND closing delimiter land in the same
 * chunk. `XMLStreamParser` emits free text up to the last newline, so a
 * multi-line block (`<checklist>` is the live example) reaches the chat
 * channel before its closing tag arrives — the raw marker is published
 * as a `streaming_delta` and lands in the Redis TURN_BUFFER, while the
 * durable `chat.jsonl` line stays clean because `LLMResponseService`
 * re-runs `transformAndStrip` over the whole flushed buffer. Net effect:
 * a clean transcript with a dirty live overlay.
 *
 * This gate closes that window. It sits in `ResponseRenderer`, upstream
 * of `chatAPI.sendLLMEvent`, and withholds text from the opening
 * delimiter of any suppressed tag until the matching close arrives —
 * then drops the whole block.
 *
 * It introduces NO policy: the suppressed set is derived from
 * `OutputTagRegistry.suppressedTagNames()`, so registering a new
 * suppressed tag extends the hold-back with no change here. Suppression
 * of a complete same-chunk tag is still the transformer's job; this gate
 * only removes the chunk-split escape hatch.
 *
 * Not a security boundary — the model is expected to honour the tag
 * contract. This keeps a contract slip from being visible.
 */

import {
  suppressedOpenTagPattern,
  suppressedTagShapes,
  tagClosePattern,
  tagOpenPattern,
} from '../OutputTagRegistry';

/**
 * Bytes of held text tolerated before concluding the model will never
 * close the tag. Generous next to a 30-item checklist, small enough that
 * a whole reply is never swallowed.
 */
const HOLD_MAX_BYTES = 4096;

/**
 * A trailing `<…` fragment longer than this cannot plausibly still be an
 * unfinished opening delimiter, so it is released rather than held.
 */
const TAIL_MAX_BYTES = 64;

export class SuppressedTagStreamGate {
  /** Active hold: the block opened, its close not yet seen. */
  private held?: { name: string; buf: string };

  /**
   * A chunk-final `<…` fragment with no `>` yet, which could still turn
   * into a suppressed opener. Prepended to the next chunk.
   *
   * `XMLStreamParser` holds back its own `/<[a-z]*$/` tail, but only up
   * to 500 chars and only while the fragment is bare letters — an
   * attribute-bearing `<checklist plan="p` slips through its rule 4
   * (long line, no newline, "no potential tag start"). This covers that.
   */
  private pendingTail = '';

  /**
   * Feed one streamed chunk; returns the text that may reach chat
   * (`''` when everything was withheld or dropped).
   */
  feed(chunk: string): string {
    if (!chunk) return '';

    let work = this.pendingTail + chunk;
    this.pendingTail = '';
    let out = '';

    for (;;) {
      if (this.held) {
        this.held.buf += work;
        work = '';

        const close = tagClosePattern(this.held.name).exec(this.held.buf);
        if (close) {
          // The block is complete — drop it and keep parsing the tail.
          work = this.held.buf.slice(close.index + close[0].length);
          this.held = undefined;
          if (!work) break;
          continue;
        }

        if (this.held.buf.length > HOLD_MAX_BYTES) {
          // Re-scan the released text: a second opener inside it (a double
          // contract violation) must still be held rather than emitted.
          // The first opener is stripped, so this always makes progress.
          work = this.releaseUnterminated('hold budget exceeded');
          continue;
        }
        break;
      }

      const open = suppressedOpenTagPattern().exec(work);
      if (open) {
        out += work.slice(0, open.index);
        const name = open[1];

        // A bodyless marker (`<plan-unchanged/>`, `<eval type="…"/>`) has
        // no closing delimiter to wait for, and neither does an occurrence
        // the model self-closed. Holding for a `</name>` that never
        // arrives would swallow the rest of the round.
        if (open[0].endsWith('/>') || !this.requiresClose(name)) {
          work = work.slice(open.index + open[0].length);
          if (!work) break;
          continue;
        }

        this.held = { name, buf: work.slice(open.index) };
        work = '';
        continue;
      }

      // No complete opener. Withhold only a tail that could still become
      // one; everything before it is safe to emit.
      const lastLt = work.lastIndexOf('<');
      if (lastLt !== -1 && work.indexOf('>', lastLt) === -1) {
        const tail = work.slice(lastLt);
        if (tail.length <= TAIL_MAX_BYTES && this.couldOpenSuppressed(tail)) {
          this.pendingTail = tail;
          out += work.slice(0, lastLt);
          break;
        }
      }

      out += work;
      break;
    }

    return out;
  }

  /**
   * Release whatever is still withheld at the end of a stream round.
   *
   * An unterminated block degrades rather than failing: the dangling
   * opening delimiter is stripped and the remaining prose is emitted, so
   * a contract slip costs the user the marker — never the answer.
   */
  flush(): string {
    let out = '';
    if (this.held) {
      out += this.releaseUnterminated('stream ended');
    }
    if (this.pendingTail) {
      out += this.pendingTail;
      this.pendingTail = '';
    }
    return out;
  }

  /** Drop all withheld state (stream retry — the residue is dead). */
  reset(): void {
    this.held = undefined;
    this.pendingTail = '';
  }

  /** True while text is being withheld (test/introspection surface). */
  get isHolding(): boolean {
    return this.held !== undefined || this.pendingTail.length > 0;
  }

  private releaseUnterminated(reason: string): string {
    if (!this.held) return '';
    const { name, buf } = this.held;
    this.held = undefined;
    console.warn(
      `⚠️ [SuppressedTagStreamGate] unterminated <${name}> (${reason}) — released ${buf.length} chars with the marker stripped. The tag contract requires a closing </${name}>. (docs/internals/36-output-tag-matrix.md)`,
    );
    return buf.replace(tagOpenPattern(name, true), '');
  }

  /**
   * Could `tail` (starts with `<`, contains no `>`) still complete into a
   * suppressed opening delimiter? Either the name is still being typed,
   * or the name is complete and attributes are in flight.
   */
  private couldOpenSuppressed(tail: string): boolean {
    const body = tail.slice(1);
    const typed = /^[A-Za-z-]*/.exec(body)?.[0] ?? '';
    const afterName = body.slice(typed.length);
    const lower = typed.toLowerCase();

    return suppressedTagShapes().some(({ name }) => {
      const candidate = name.toLowerCase();
      return afterName.length === 0
        ? candidate.startsWith(lower)
        : candidate === lower;
    });
  }

  /** Does this suppressed entry carry a body the gate must wait out? */
  private requiresClose(name: string): boolean {
    return (
      suppressedTagShapes().find(
        (shape) => shape.name.toLowerCase() === name.toLowerCase(),
      )?.requiresClose ?? true
    );
  }
}
