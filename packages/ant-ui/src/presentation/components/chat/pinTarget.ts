/**
 * Pin-target decision — pure, content-space geometry.
 *
 * The pin exists to answer "what was I asking?" when the prompt itself has
 * scrolled away, so it appears ONLY while no user prompt is on screen. With
 * one visible, the pin stays hidden — showing an older prompt next to a
 * visible newer one is the defect this rule exists to prevent.
 *
 * Two further properties make the decision reliable:
 *
 * - **Content coordinates, not viewport rects.** A bubble's offset inside the
 *   scrollable content is stable while the content above it is unchanged, so
 *   the caller can cache it. Virtualization unmounting a bubble then cannot
 *   change the answer — which is what let an earlier mounted-range fallback
 *   walk the pin backwards, and to null, on the first few pixels of scroll.
 * - **`topInset` accounts for the pin bar itself.** A prompt behind the pin is
 *   not readable, so it counts as scrolled-off and stays pinned until it
 *   clears the bar.
 */

import type { Turn } from '@/domain/store/selectors/chat';

/** Position of one user bubble inside the scrollable content. */
export interface BubbleMetrics {
  /** Distance from the top of the scrollable content to the bubble's top. */
  offset: number;
  height: number;
  /**
   * Measured on the current pass. False once virtualization dropped the
   * element: the offset is still usable for "has it scrolled above?", but a
   * stale entry must never be read as "on screen" — suppressing the pin on
   * stale data is the failure mode this feature keeps regressing into.
   */
  mounted: boolean;
}

/** The visible slice of the scroll surface, and what the pin covers of it. */
export interface PinViewport {
  scrollTop: number;
  /** Visible height of the scroll surface (`clientHeight`). */
  height: number;
  /** Height of the pin overlay covering the top of that surface. */
  topInset: number;
}

/** Structural minimum `resolvePinTarget` reads off a turn. */
export type PinCandidateTurn = Pick<Turn, 'turnId' | 'user'>;

/**
 * Index of the prompt to pin, or null when a prompt is on screen (or none has
 * scrolled off yet).
 *
 * @param offsets keyed by `turnId`; turns absent from it are not candidates.
 *   That is safe: a bubble that has never been measured is older than every
 *   measured one, and the answer is always the NEWEST scrolled-off prompt.
 */
export function resolvePinTarget(
  turns: PinCandidateTurn[],
  offsets: Map<string, BubbleMetrics>,
  viewport: PinViewport,
): number | null {
  const readableTop = viewport.scrollTop + viewport.topInset;
  const viewportBottom = viewport.scrollTop + viewport.height;

  // Newest first. Turns are chronological and laid out top-to-bottom, so
  // `offset` grows with the index — which makes both early returns exhaustive
  // rather than a tie-break: once a prompt is above, every older one is
  // further above and cannot be visible, and everything newer has already
  // been classified on this pass.
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn?.user?.text) continue;
    const metrics = offsets.get(turn.turnId);
    if (!metrics) continue;

    if (metrics.offset + metrics.height <= readableTop) return i; // scrolled off
    if (metrics.mounted && metrics.offset < viewportBottom) return null; // on screen
    // Below the viewport — not yet reached. Keep looking further back.
  }
  return null;
}
