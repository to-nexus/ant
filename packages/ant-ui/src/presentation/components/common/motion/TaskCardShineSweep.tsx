import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/shared/utils/design-system';

export type ShineSweepVariant = 'todo' | 'completed';

interface VariantStyle {
  /** Background glow gradient (light + dark blended via Tailwind classes). */
  glowClassName: string;
  /** Linear-gradient string for the moving highlight band. */
  sweepGradient: string;
  /** Box-shadow that surrounds the moving highlight (warmth/halo). */
  sweepBoxShadow: string;
}

const VARIANTS: Record<ShineSweepVariant, VariantStyle> = {
  // Golden — preserves the previous completed-column visual.
  completed: {
    glowClassName:
      'bg-gradient-to-r from-yellow-200/60 via-yellow-100/80 to-yellow-200/60 blur-sm',
    sweepGradient:
      'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 20%, rgba(255,255,200,0.95) 40%, rgba(255,255,255,1) 50%, rgba(255,255,200,0.95) 60%, rgba(255,255,255,0.3) 80%, transparent 100%)',
    sweepBoxShadow:
      '0 0 30px 10px rgba(255,255,150,0.8), inset 0 0 20px rgba(255,255,255,0.5)',
  },
  // Cyan/blue — matches the existing PopAppear ring tone for newly-added todos.
  todo: {
    glowClassName:
      'bg-gradient-to-r from-sky-200/50 via-cyan-100/70 to-sky-200/50 blur-sm',
    sweepGradient:
      'linear-gradient(90deg, transparent 0%, rgba(186,230,253,0.35) 20%, rgba(207,250,254,0.9) 40%, rgba(255,255,255,1) 50%, rgba(207,250,254,0.9) 60%, rgba(186,230,253,0.35) 80%, transparent 100%)',
    sweepBoxShadow:
      '0 0 28px 8px rgba(125,211,252,0.7), inset 0 0 18px rgba(255,255,255,0.45)',
  },
};

interface TaskCardShineSweepProps {
  variant: ShineSweepVariant;
  /** When false the wrapper renders children only — no animation layers. */
  active: boolean;
  /** Optional rounded-* class to match the wrapped card. Defaults to `rounded-lg`. */
  rounded?: string;
  /** Extra className applied to the outer relative wrapper. */
  className?: string;
  children: ReactNode;
}

/**
 * Shared "shine sweep" entrance overlay for task cards.
 *
 * Renders two stacked overlays above the card during a one-shot animation:
 *   1. a soft background glow pulse, and
 *   2. a horizontal highlight band that sweeps across the card.
 *
 * Both layers are pointer-transparent and self-terminate; the consumer
 * controls when the effect plays via the `active` prop (e.g. wired to
 * `useNewlyAdded`). When inactive — or when the user prefers reduced
 * motion — only `children` render, wrapped in a `relative z-10` slot to
 * keep stacking consistent with the active state.
 *
 * Used by:
 *   - `KanbanColumns` completed column (variant="completed", golden tone)
 *   - `PopAppear` todo entrance         (variant="todo",      cyan/blue tone)
 */
export function TaskCardShineSweep({
  variant,
  active,
  rounded = 'rounded-lg',
  className,
  children,
}: TaskCardShineSweepProps) {
  const reduceMotion = useReducedMotion();
  const play = active && !reduceMotion;
  const style = VARIANTS[variant];

  return (
    <div
      className={cn('relative min-w-0', className)}
      style={play ? { isolation: 'isolate' } : undefined}
    >
      {play && (
        <>
          <motion.div
            aria-hidden
            className={cn('absolute inset-0 pointer-events-none', rounded)}
            style={{ zIndex: 99 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.5, 0] }}
            transition={{
              duration: 1,
              times: [0, 0.2, 0.5, 1],
              ease: 'easeInOut',
            }}
          >
            <div className={cn('absolute inset-0', style.glowClassName)} />
          </motion.div>

          <motion.div
            aria-hidden
            className={cn(
              'absolute inset-0 pointer-events-none overflow-hidden',
              rounded,
            )}
            style={{ zIndex: 100 }}
          >
            <motion.div
              className="absolute inset-0"
              initial={{ x: '-100%' }}
              animate={{ x: '200%' }}
              transition={{
                duration: 0.7,
                ease: [0.4, 0, 0.2, 1],
                delay: 0.2,
              }}
              style={{
                background: style.sweepGradient,
                boxShadow: style.sweepBoxShadow,
                filter: 'blur(1px)',
              }}
            />
          </motion.div>
        </>
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
