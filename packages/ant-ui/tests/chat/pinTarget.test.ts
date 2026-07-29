/**
 * resolvePinTarget — which user prompt is pinned at the top of the chat.
 *
 * The rule: the pin exists ONLY while no user prompt is on screen. When one is
 * visible the pin stays hidden; when none is, it shows the most recent prompt
 * above the viewport.
 *
 * Three regressions are locked here.
 *
 * (1) chat-SSOT migration (7a7d8a7e6): rows became whole turns (prompt +
 *     entire response), so row-level visibility could no longer answer "has
 *     the prompt scrolled off?" — the pin cleared at nearly every position.
 *
 * (2) the first fix's mounted-range fallback tracked MOUNT STATE rather than
 *     scroll position, so scrolling a few pixels mounted one more row, walked
 *     the answer backwards and hit null — the pin vanished the instant you
 *     started scrolling. Guarded by the cached-offset cases below.
 *
 * (3) the second fix dropped the suppression clause entirely, so an older
 *     prompt was pinned above a perfectly visible newer one. That is the
 *     `visible prompt suppresses` group, and the sweep at the end.
 */

import { describe, it, expect } from 'vitest';
import type { ChatUserTurnLine } from '@ant/shared';
import {
  resolvePinTarget,
  type BubbleMetrics,
  type PinCandidateTurn,
  type PinViewport,
} from '../../src/presentation/components/chat/pinTarget';

/** Height of the pin bar — content behind it is covered, so not readable. */
const TOP_INSET = 48;
const VIEWPORT_H = 800;
const BUBBLE_H = 80;

function view(scrollTop: number, height = VIEWPORT_H): PinViewport {
  return { scrollTop, height, topInset: TOP_INSET };
}

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

/** Bubble of turn i sits at content offset `offsets[i]`, mounted unless in `stale`. */
function metrics(
  offsets: Record<number, number>,
  stale: number[] = [],
): Map<string, BubbleMetrics> {
  return new Map(
    Object.entries(offsets).map(([i, offset]) => [
      `turn-${i}`,
      { offset, height: BUBBLE_H, mounted: !stale.includes(Number(i)) },
    ]),
  );
}

describe('resolvePinTarget', () => {
  describe('a visible prompt suppresses the pin', () => {
    it('does not pin an older prompt while a newer one is on screen', () => {
      // THE round-3 REGRESSION, in the reported shape: prompt 5 sits mid-screen
      // and prompt 6 is below it. Older prompts are far above, but the pin must
      // stay hidden — the user can already see what they asked.
      const ts = turns(7);
      const offsets = metrics({ 0: 0, 1: 900, 2: 1800, 3: 2700, 4: 3600, 5: 4500, 6: 9000 });
      // Viewport [4200, 5000): prompt 5 at [4500, 4580] is visible, 6 is below.
      expect(resolvePinTarget(ts, offsets, view(4200))).toBeNull();
    });

    it('pins the preceding prompt once the visible one drops below the viewport', () => {
      // Continuation of the case above: scrolled up until prompt 5 is below the
      // viewport and nothing is on screen → prompt 4 takes over.
      const ts = turns(7);
      const offsets = metrics({ 0: 0, 1: 900, 2: 1800, 3: 2700, 4: 3600, 5: 4500, 6: 9000 });
      // Viewport [3700, 4500): 4 is above (bottom 3680), 5 starts exactly at the
      // bottom edge, so nothing is on screen.
      expect(resolvePinTarget(ts, offsets, view(3700))).toBe(4);
    });

    it('does not pin when the only prompt is on screen', () => {
      expect(resolvePinTarget(turns(1), metrics({ 0: 1000 }), view(900))).toBeNull();
    });

    it('does not pin when a prompt below the viewport is the only one', () => {
      // Nothing has scrolled off yet — at the top of the history.
      expect(resolvePinTarget(turns(1), metrics({ 0: 2000 }), view(0))).toBeNull();
    });
  });

  describe('scrolled-off prompts', () => {
    it('pins the prompt of the response being read', () => {
      // Deep inside one tall turn: the row is still on screen, its bubble is not.
      expect(resolvePinTarget(turns(1), metrics({ 0: 0 }), view(4000))).toBe(0);
    });

    it('pins the newest prompt at the tail of a long response', () => {
      // The everyday case: sitting at the bottom, the last prompt is far above.
      const ts = turns(3);
      const offsets = metrics({ 0: 0, 1: 500, 2: 1000 });
      expect(resolvePinTarget(ts, offsets, view(5000))).toBe(2);
    });

    it('keeps the prompt pinned while it is hidden behind the pin bar', () => {
      // Bubble occupies [0, 80]; readable top is 40 + 48 = 88. The bubble is
      // inside the scroll viewport but behind the pin, so it is not readable
      // and must stay pinned — otherwise the pin blinks out early.
      expect(resolvePinTarget(turns(1), metrics({ 0: 0 }), view(40))).toBe(0);
    });

    it('releases the pin once the prompt clears the pin bar', () => {
      // Bubble bottom 80, readable top 10 + 48 = 58 → genuinely on screen.
      expect(resolvePinTarget(turns(1), metrics({ 0: 0 }), view(10))).toBeNull();
    });

    it('walks past turns that carry no prompt', () => {
      const ts = turns(3, [2]);
      expect(resolvePinTarget(ts, metrics({ 0: 0, 1: 1000, 2: 2000 }), view(5000))).toBe(1);
    });

    it('ignores an empty prompt so it cannot shadow an earlier real one', () => {
      const ts = turns(2);
      ts[1] = { turnId: 'turn-1', user: userLine('') };
      expect(resolvePinTarget(ts, metrics({ 0: 0, 1: 1000 }), view(5000))).toBe(0);
    });
  });

  describe('the offset cache outlives its elements', () => {
    it('counts a bubble that has been unmounted since it was measured', () => {
      // Virtualization dropping turn 0's row must not change the answer.
      expect(resolvePinTarget(turns(2), metrics({ 0: 0 }, [0]), view(4000))).toBe(0);
    });

    it('never reads a stale entry as on screen', () => {
      // turn-1's cached offset falls inside the viewport, but it is unmounted so
      // the offset cannot be trusted for visibility. Suppressing the pin here
      // would resurrect the "pin vanishes" class of bug; treat it as not-yet
      // reached and fall through to the scrolled-off prompt instead.
      const offsets = metrics({ 0: 0, 1: 4200 }, [1]);
      expect(resolvePinTarget(turns(2), offsets, view(4000))).toBe(0);
    });

    it('ignores turns that have never been measured', () => {
      // turn 1 has no entry → not a candidate, and cannot suppress either.
      expect(resolvePinTarget(turns(2), metrics({ 0: 0 }), view(5000))).toBe(0);
    });

    it('returns null with an empty metrics map', () => {
      expect(resolvePinTarget(turns(3), new Map(), view(5000))).toBeNull();
    });

    it('returns null with no turns', () => {
      expect(resolvePinTarget([], new Map(), view(0))).toBeNull();
    });
  });

  it('sweep: never pins an older prompt while a newer one is on screen', () => {
    // The invariant, asserted across every scroll position of a synthetic
    // layout rather than at hand-picked points. Note the pin deliberately
    // alternates present/absent as each prompt crosses the viewport, so
    // monotonicity must NOT be asserted — that would lock in the round-2 rule.
    const ts = turns(3);
    const layout = { 0: 0, 1: 2000, 2: 4000 };
    const offsets = metrics(layout);

    let sawPin = false;
    let sawNull = false;

    for (let scrollTop = 6000; scrollTop >= 0; scrollTop -= 25) {
      const viewport = view(scrollTop);
      const result = resolvePinTarget(ts, offsets, viewport);

      const readableTop = scrollTop + TOP_INSET;
      const viewportBottom = scrollTop + VIEWPORT_H;
      const onScreen = Object.values(layout).some(
        (offset) => offset + BUBBLE_H > readableTop && offset < viewportBottom,
      );

      if (onScreen) {
        expect(result, `scrollTop=${scrollTop}: a prompt is on screen`).toBeNull();
        sawNull = true;
      } else if (result !== null) {
        // Whatever is pinned must itself be scrolled off, and be the newest such.
        const pinned = layout[result as keyof typeof layout];
        expect(pinned + BUBBLE_H, `scrollTop=${scrollTop}`).toBeLessThanOrEqual(readableTop);
        const newer = Object.entries(layout).filter(
          ([i, offset]) => Number(i) > result && offset + BUBBLE_H <= readableTop,
        );
        expect(newer, `scrollTop=${scrollTop}: a newer prompt was also off-screen`).toHaveLength(0);
        sawPin = true;
      }
    }

    // The sweep is only meaningful if it exercised both states.
    expect(sawPin).toBe(true);
    expect(sawNull).toBe(true);
  });
});
