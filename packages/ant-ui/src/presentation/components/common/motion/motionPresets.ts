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
