/**
 * Width and wrapping measures for the settings kit.
 *
 * These were hard pixel constants, which is why settings content wrapped far
 * short of its container: a card 1200px wide still broke its description at
 * 560px, and a fixed-width input neither grew on a wide panel nor shrank on a
 * narrow one. Every value here is now `min(100%, …)` — it fills the container
 * up to a real limit and can never overflow it.
 *
 * A card description and a field hint are the SAME role — explanatory prose —
 * so they must wrap at the same measure. They had drifted into three (560 for
 * a description, 480 for an org card body, 380 for the danger-zone copy),
 * which reads as three text columns stacked in one scroller.
 */

/**
 * Prose. Font-relative (`ch`), so an 11.5px hint and a 12px description each
 * get their own sensible line length instead of sharing one pixel value.
 */
export const PROSE_MEASURE = 'min(100%, 92ch)';

/** A single control row (input + button). Grows on a wide card, bounded. */
export const CONTROL_MEASURE = 'min(100%, 720px)';

/** A short token field (id, file name, select) — a fluid cap, not a fixed width. */
export const FIELD_MEASURE = 'min(100%, 320px)';

/**
 * Long-form prose wrapping. The app sets `word-break: keep-all` globally,
 * which is right for Korean UI labels but pairs with `overflow-wrap:
 * break-word` to make a Korean word glued to a long Latin token (`mcp__server__tool을`)
 * one unbreakable unit — it gets pushed whole to the next line and leaves a
 * wide ragged gap. `anywhere` lets the browser consider break points inside
 * that token when filling the line, while `keep-all` still protects the word.
 * Apply to prose surfaces only, never to labels, chips or paths.
 */
export const PROSE_WRAP = { overflowWrap: 'anywhere' } as const;
