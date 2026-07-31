/**
 * Shared motion presets for ant-ui.
 *
 * Centralised so any future adopter (Pill, VariantCard, breadcrumb chips, …)
 * can pull the same physics constants instead of fragmenting numbers across
 * inline `transition={{ ... }}` literals.
 */

export const QUIET_FADE_DURATION = 0.18;

/**
 * Default time (ms) the {@link useNewlyAdded} hook keeps an item flagged as
 * "newly added" so a one-shot entrance can run. Sized to outlast the
 * {@link TaskCardShineSweep} sweep (0.7s + 0.2s delay) with a small margin —
 * the kanban completed column passes the same value explicitly for clarity.
 */
export const NEWLY_ADDED_AUTO_CLEAR_MS = 1200;

/**
 * Default time (ms) the {@link useSettlingExit} hook holds an item that just
 * left the active set, so its terminal state registers before it disappears.
 *
 * Budget: ~520ms flash + check pop, ~280ms readable hold, 300ms fade-out.
 * Long enough to notice, short enough that a burst of tasks finishing together
 * doesn't leave a stale-looking strip behind.
 */
export const SETTLE_FAREWELL_MS = 1100;

/** Tail of {@link SETTLE_FAREWELL_MS} spent fading the item out. */
export const SETTLE_FADE_OUT_MS = 300;
