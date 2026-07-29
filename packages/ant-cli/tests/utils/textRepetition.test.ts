/**
 * StreamRepetitionTracker — in-stream degeneration breaker heuristics.
 *
 * Incident shapes it must catch:
 *  - sage-causing-rover: "Let me read the update method." × 325 (locked
 *    single sentence, streamed in small deltas)
 *  - vivid-orbiting-dodge: two sentences alternating A/B/A/B
 * Shapes it must NEVER flag: normal technical prose, markdown tables with a
 * repeated short separator row, list-shaped reports.
 */

import { describe, it, expect } from 'vitest';
import {
  StreamRepetitionTracker,
  normalizeAssistantText,
  hashText,
} from '../../src/core/utils/textRepetition';

const LOOP_SENTENCE = 'Let me read the update method that animates the ringFragments. ';
const ALT_A = 'Let me also look at the resolveGateIsGain and the membrane state thresholds. ';
const ALT_B = 'Let me read the update method for the ring fragment animation logic. ';

describe('StreamRepetitionTracker', () => {
  it('trips on the locked single-sentence loop (incident shape), fed in small deltas', () => {
    const t = new StreamRepetitionTracker();
    const stream = LOOP_SENTENCE.repeat(20);
    let tripped = false;
    // Simulate token-ish deltas of 7 chars.
    for (let i = 0; i < stream.length && !tripped; i += 7) {
      tripped = t.push(stream.slice(i, i + 7));
    }
    expect(tripped).toBe(true);
  });

  it('trips on the A/B alternating loop (vivid-orbiting-dodge shape)', () => {
    const t = new StreamRepetitionTracker();
    let tripped = false;
    for (let i = 0; i < 10 && !tripped; i++) {
      tripped = t.push(i % 2 === 0 ? ALT_A : ALT_B);
    }
    expect(tripped).toBe(true);
  });

  it('does not trip on distinct technical prose', () => {
    const t = new StreamRepetitionTracker();
    for (let i = 0; i < 100; i++) {
      expect(
        t.push(`Finding ${i}: module m${i} exports f${i} consumed by layer ${i % 5} at src/file${i}.ts:${i + 1}. `),
      ).toBe(false);
    }
  });

  it('does not trip on repeated SHORT units (markdown separators, list bullets)', () => {
    const t = new StreamRepetitionTracker();
    for (let i = 0; i < 200; i++) {
      expect(t.push('| --- | --- |\n')).toBe(false);
    }
  });

  it('does not trip before the minimum total volume (legitimate emphasis)', () => {
    const t = new StreamRepetitionTracker(4, 20, 400);
    // 3 repeats of a 30-char sentence = 90 chars < 400 floor and streak < 4.
    for (let i = 0; i < 3; i++) {
      expect(t.push('This exact sentence repeats twice for emphasis. ')).toBe(false);
    }
  });

  it('reset() clears state (provider retry replay)', () => {
    const t = new StreamRepetitionTracker();
    t.push(LOOP_SENTENCE.repeat(4));
    t.reset();
    expect(t.tripped).toBe(false);
    // Post-reset, distinct text stays clean.
    expect(t.push('Fresh content after retry, no repetition here at all. ')).toBe(false);
  });

  it('short interleaved units break the streak (A. -. A. -. never accumulates)', () => {
    const t = new StreamRepetitionTracker();
    for (let i = 0; i < 30; i++) {
      t.push(`${ALT_A}ok.\n`);
    }
    // The short "ok." line resets the streak each cycle — never trips.
    expect(t.tripped).toBe(false);
  });
});

describe('single-owner primitives', () => {
  it('normalizeAssistantText collapses case and whitespace', () => {
    expect(normalizeAssistantText('  Foo   BAR\n baz ')).toBe('foo bar baz');
  });

  it('hashText is stable and collision-distinct for the incident sentences', () => {
    expect(hashText(normalizeAssistantText(ALT_A))).toBe(hashText(normalizeAssistantText(ALT_A)));
    expect(hashText(normalizeAssistantText(ALT_A))).not.toBe(hashText(normalizeAssistantText(ALT_B)));
  });
});
