import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/design-system';
import { QUIET_FADE_DURATION } from './motionPresets';
import { TaskCardShineSweep } from './TaskCardShineSweep';

interface PopAppearProps {
  /**
   * When true, plays the entrance shine sweep across the whole card.
   * When false, mounts with a near-imperceptible fade — used for items that
   * were already on screen before the consumer started observing.
   */
  fresh: boolean;
  /** Forwarded to framer-motion `layoutId` so column-to-column transitions stay shared. */
  layoutId?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Generic entrance wrapper used by Kanban todo cards (and reusable elsewhere).
 *
 * - `fresh` items quietly fade-in while a `TaskCardShineSweep` (todo variant)
 *   sweeps a horizontal highlight across the whole card. The shine is the
 *   primary attention cue; the entrance itself stays subtle so the two
 *   effects don't fight each other.
 * - Non-fresh items fade in quietly so initial mounts don't all detonate together.
 * - Honours `prefers-reduced-motion` via framer's `useReducedMotion`; the
 *   shine layer also self-disables under reduced motion.
 */
export function PopAppear({
  fresh,
  layoutId,
  className,
  children,
}: PopAppearProps) {
  const reduceMotion = useReducedMotion();
  const playEntrance = fresh && !reduceMotion;

  return (
    <motion.div
      layoutId={layoutId}
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: QUIET_FADE_DURATION }}
      className={cn('relative min-w-0', className)}
    >
      <TaskCardShineSweep variant="todo" active={playEntrance}>
        {children}
      </TaskCardShineSweep>
    </motion.div>
  );
}
