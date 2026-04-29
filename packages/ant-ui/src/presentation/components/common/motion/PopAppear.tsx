import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/design-system';
import { POP_SPRING, QUIET_FADE_DURATION } from './motionPresets';

interface PopAppearProps {
  /**
   * When true, plays the full "pop" entrance (overshoot spring + ring glow).
   * When false, mounts with a near-imperceptible fade — used for items that
   * were already on screen before the consumer started observing.
   */
  fresh: boolean;
  /** Forwarded to framer-motion `layoutId` so column-to-column transitions stay shared. */
  layoutId?: string;
  className?: string;
  /** Tailwind ring/border colour override for the one-shot glow. */
  ringClassName?: string;
  children: ReactNode;
}

/**
 * Generic entrance wrapper used by Kanban todo cards (and reusable elsewhere).
 *
 * - `fresh` items spring in with a slight overshoot + a CSS-driven `task-pop-ring`
 *   glow that runs once and self-terminates (no JS timer required).
 * - Non-fresh items fade in quietly so initial mounts don't all detonate together.
 * - Honours `prefers-reduced-motion` via framer's `useReducedMotion`.
 */
export function PopAppear({
  fresh,
  layoutId,
  className,
  ringClassName,
  children,
}: PopAppearProps) {
  const reduceMotion = useReducedMotion();
  const playPop = fresh && !reduceMotion;

  const initial = playPop
    ? { opacity: 0, scale: 0.55, y: 14 }
    : { opacity: 0, scale: 0.97 };
  const transition = playPop ? POP_SPRING : { duration: QUIET_FADE_DURATION };

  return (
    <motion.div
      layoutId={layoutId}
      layout
      initial={initial}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={transition}
      className={cn('relative min-w-0', className)}
    >
      {playPop && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 rounded-lg task-pop-ring',
            ringClassName,
          )}
        />
      )}
      {children}
    </motion.div>
  );
}
