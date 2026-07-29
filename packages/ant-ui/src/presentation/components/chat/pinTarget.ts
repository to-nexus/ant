/**
 * Pin-target decision — pure, content-space geometry.
 *
 * The pin answers one question: which user prompt has scrolled out of view
 * above? Two properties make this reliable where the previous versions were
 * not:
 *
 * - **Content coordinates, not viewport rects.** A bubble's offset inside the
 *   scrollable content is stable while the content above it is unchanged, so
 *   the caller can cache it. Virtualization unmounting a bubble then cannot
 *   change the answer — which is what let the old mounted-range fallback walk
 *   the pin backwards, and to null, on the first few pixels of scroll.
 * - **`topInset` accounts for the pin bar itself.** A prompt hidden behind the
 *   pin is not visible, so it stays pinned until it clears the bar.
 */

import type { Turn } from '@/domain/store/selectors/chat';

/** Position of one user bubble inside the scrollable content. */
export interface BubbleMetrics {
  /** Distance from the top of the scrollable content to the bubble's top. */
  offset: number;
  height: number;
}

/** Structural minimum `resolvePinTarget` reads off a turn. */
export type PinCandidateTurn = Pick<Turn, 'turnId' | 'user'>;

/**
 * Index of the newest turn whose prompt has scrolled above the readable top
 * edge, or null when the newest prompt is still on screen.
 *
 * @param offsets keyed by `turnId`; turns absent from it are not candidates.
 *   That is safe: a bubble that has never been measured is older than every
 *   measured one, and the answer is always the NEWEST off-screen prompt.
 * @param topInset height of the pin overlay — content above it is covered.
 */
export function resolvePinTarget(
  turns: PinCandidateTurn[],
  offsets: Map<string, BubbleMetrics>,
  scrollTop: number,
  topInset: number,
): number | null {
  const readableTop = scrollTop + topInset;

  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn?.user?.text) continue;
    const metrics = offsets.get(turn.turnId);
    if (!metrics) continue;
    if (metrics.offset + metrics.height <= readableTop) return i;
  }
  return null;
}
