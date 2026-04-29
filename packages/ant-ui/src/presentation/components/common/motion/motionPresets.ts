import type { Transition } from 'framer-motion';

/**
 * Shared motion presets for ant-ui.
 *
 * Centralised so any future adopter (Pill, VariantCard, breadcrumb chips, …)
 * can pull the same physics constants instead of fragmenting numbers across
 * inline `transition={{ ... }}` literals.
 */

export const POP_SPRING: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 16,
  mass: 0.6,
};

export const QUIET_FADE_DURATION = 0.18;

export const POP_RING_DURATION_MS = 520;
export const NEWLY_ADDED_AUTO_CLEAR_MS = 700;
