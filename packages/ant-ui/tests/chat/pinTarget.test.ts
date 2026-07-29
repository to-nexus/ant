/**
 * resolvePinTarget — which user prompt is pinned at the top of the chat.
 *
 * Two regressions are locked here.
 *
 * (1) chat-SSOT migration (7a7d8a7e6): rows became whole turns (prompt +
 *     entire response), so row-level visibility could no longer answer
 *     "has the prompt scrolled off?" — the pin cleared at nearly every
 *     scroll position.
 *
 * (2) the first fix's mounted-range fallback: when the geometry input came
 *     back empty, the pin fell through to "newest prompt below Virtuoso's
 *     rendered-range start", which tracks MOUNT STATE rather than scroll
 *     position. Scrolling a few pixels mounted one more row, walked the
 *     answer backwards, and hit null — the pin vanished the instant you
 *     started scrolling. The `scroll monotonicity` case below is the guard.
 */

import { describe, it, expect } from 'vitest';
import type { ChatUserTurnLine } from '@ant/shared';
import {
  resolvePinTarget,
  type BubbleMetrics,
  type PinCandidateTurn,
} from '../../src/presentation/components/chat/pinTarget';

/** Height of the pin bar — content above it is covered, so not readable. */
const TOP_INSET = 48;
const BUBBLE_H = 80;

function userLine(text: string): ChatUserTurnLine {
  return {
    type: 'user_turn',
    ts: '2026-07-29T00:00:00.000Z',
    jobId: 'j1',
    turnId: 't1',
    jobType: 'code',
    text,
    sourceRef: 'chat',
  };
}

/** `n` turns keyed `turn-0..n-1`, each with a prompt unless listed in `without`. */
function turns(n: number, without: number[] = []): PinCandidateTurn[] {
  return Array.from({ length: n }, (_, i) =>
    without.includes(i)
      ? { turnId: `turn-${i}`, user: undefined }
      : { turnId: `turn-${i}`, user: userLine(`prompt ${i}`) },
  );
}

/** Bubble of turn i sits at content offset `offsets[i]`. */
function metrics(offsets: Record<number, number>): Map<string, BubbleMetrics> {
  return new Map(
    Object.entries(offsets).map(([i, offset]) => [`turn-${i}`, { offset, height: BUBBLE_H }]),
  );
}

describe('resolvePinTarget', () => {
  it('does not pin while the prompt is fully readable', () => {
    // Bubble bottom at 1080, readable top at 1000+48 → still on screen.
    const target = resolvePinTarget(turns(1), metrics({ 0: 1000 }), 1000, TOP_INSET);
    expect(target).toBeNull();
  });

  it('pins the prompt of the response being read', () => {
    // Deep inside one tall turn: the row is still on screen, its bubble is not.
    const target = resolvePinTarget(turns(1), metrics({ 0: 0 }), 4000, TOP_INSET);
    expect(target).toBe(0);
  });

  it('keeps the prompt pinned while it is hidden behind the pin bar', () => {
    // Bubble bottom = 80, readable top = 40+48 = 88. The bubble has scrolled
    // out of the *readable* area even though it is inside the scroll viewport
    // — it is behind the pin, so it must stay pinned.
    const target = resolvePinTarget(turns(1), metrics({ 0: 0 }), 40, TOP_INSET);
    expect(target).toBe(0);
  });

  it('releases the pin once the prompt clears the pin bar', () => {
    // Bubble bottom = 80, readable top = 10+48 = 58 → genuinely visible.
    const target = resolvePinTarget(turns(1), metrics({ 0: 0 }), 10, TOP_INSET);
    expect(target).toBeNull();
  });

  it('pins the newest off-screen prompt, not the visible one', () => {
    // Turn 1's bubble is visible below the bar; the viewport is filled by
    // turn 0's response → pin turn 0.
    const target = resolvePinTarget(
      turns(2),
      metrics({ 0: 0, 1: 3000 }),
      2960,
      TOP_INSET,
    );
    expect(target).toBe(0);
  });

  it('prefers the latest qualifying prompt when several are above', () => {
    const target = resolvePinTarget(
      turns(3),
      metrics({ 0: 0, 1: 1000, 2: 5000 }),
      2000,
      TOP_INSET,
    );
    expect(target).toBe(1);
  });

  it('counts a bubble that has been unmounted since it was measured', () => {
    // The metrics map deliberately outlives the elements. Virtualization
    // dropping turn 0's row must not change the answer.
    const cached = metrics({ 0: 0 });
    expect(resolvePinTarget(turns(2), cached, 4000, TOP_INSET)).toBe(0);
  });

  it('scroll monotonicity: the pin never blinks out while a prompt is above', () => {
    // THE round-2 REGRESSION. One fixed offset table, sweep scrollTop from the
    // bottom of a tall turn up to the point the prompt becomes readable. The
    // answer must stay 0 the whole way and only then become null — never
    // oscillate, never drop out early.
    const ts = turns(1);
    const cached = metrics({ 0: 0 }); // bubble occupies content [0, 80]
    const seen: Array<number | null> = [];
    for (let scrollTop = 4000; scrollTop >= 0; scrollTop -= 40) {
      seen.push(resolvePinTarget(ts, cached, scrollTop, TOP_INSET));
    }
    // Exactly one transition, and it is 0 → null (never back again).
    const firstNull = seen.indexOf(null);
    expect(firstNull).toBeGreaterThan(0);
    expect(seen.slice(0, firstNull)).toEqual(seen.slice(0, firstNull).map(() => 0));
    expect(seen.slice(firstNull).every((v) => v === null)).toBe(true);
  });

  it('walks past turns that carry no prompt', () => {
    const target = resolvePinTarget(
      turns(3, [2]),
      metrics({ 0: 0, 1: 1000, 2: 2000 }),
      5000,
      TOP_INSET,
    );
    expect(target).toBe(1);
  });

  it('ignores an empty prompt so it cannot shadow an earlier real one', () => {
    const ts = turns(2);
    ts[1] = { turnId: 'turn-1', user: userLine('') };
    const target = resolvePinTarget(ts, metrics({ 0: 0, 1: 1000 }), 5000, TOP_INSET);
    expect(target).toBe(0);
  });

  it('ignores turns that have never been measured', () => {
    // turn 1 has no metrics entry → not a candidate. Harmless: an unmeasured
    // bubble is always older than every measured one.
    const target = resolvePinTarget(turns(2), metrics({ 0: 0 }), 5000, TOP_INSET);
    expect(target).toBe(0);
  });

  it('returns null with an empty metrics map', () => {
    const target = resolvePinTarget(turns(3), new Map(), 5000, TOP_INSET);
    expect(target).toBeNull();
  });

  it('returns null with no turns', () => {
    expect(resolvePinTarget([], new Map(), 0, TOP_INSET)).toBeNull();
  });
});
