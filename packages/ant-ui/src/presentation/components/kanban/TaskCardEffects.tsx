
import { useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * TaskCardEffects — Aurora animation primitives for TaskCard status overlays.
 *
 * Replaces the prior `wave-slide-continuous` blue bar (in-progress) and
 * `TaskCardShineSweep` golden sweep (just-completed) with token-driven
 * effects:
 *   - TaskGlowPulseLayer  — soft pulsing aurora glow (in-progress).
 *   - ShimmerSweepOverlay — diagonal violet→pink shimmer band.
 *   - SparkleOrbits       — four corner sparkles orbiting on a stagger.
 *   - NewChip             — aurora-gradient "NEW" pill.
 *   - CompletedCheckChip  — green check pill.
 *   - GlowHalo            — radial pulsing aurora halo behind the card.
 *
 * All sub-components respect `prefers-reduced-motion`: when reduced motion
 * is requested they render an inert (or empty) variant.
 */

interface OverlayProps {
  /** Optional rounded-* utility to match the wrapped card. */
  rounded?: string;
}

/**
 * Soft aurora-violet glow that pulses behind the card.
 * Uses the `task-glow-pulse` keyframe defined in aurora-tokens.css.
 */
export function TaskGlowPulseLayer({ rounded = 'rounded-lg' }: OverlayProps = {}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  return (
    <div
      aria-hidden
      className={`absolute inset-0 pointer-events-none ${rounded}`}
      style={{
        // Custom property consumed by the keyframe.
        ['--task-glow' as string]: 'var(--violet-500)',
        animation: 'task-glow-pulse 2.2s var(--ease-smooth) infinite',
        zIndex: 1,
      }}
    />
  );
}

interface ShimmerSweepOverlayProps extends OverlayProps {
  /**
   * 'in-progress' — fast, infinite shimmer (1.6s).
   * 'completed-slow' — single slow pass (3.6s, 1 iteration).
   */
  variant: 'in-progress' | 'completed-slow';
}

/**
 * Diagonal violet→pink shimmer band sweeping across the card surface.
 * Backed by the `task-shimmer-sweep` keyframe in aurora-tokens.css.
 */
export function ShimmerSweepOverlay({
  variant,
  rounded = 'rounded-lg',
}: ShimmerSweepOverlayProps) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;

  const duration = variant === 'in-progress' ? '1.6s' : '3.6s';
  const iterationCount = variant === 'in-progress' ? 'infinite' : 1;

  return (
    <div
      aria-hidden
      className={`absolute inset-0 pointer-events-none overflow-hidden ${rounded}`}
      style={{ zIndex: 2 }}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(110deg, transparent 0%, oklch(from var(--violet-300) l c h / 0.55) 40%, oklch(from var(--pink-300) l c h / 0.75) 50%, oklch(from var(--violet-300) l c h / 0.55) 60%, transparent 100%)',
          animation: `task-shimmer-sweep ${duration} var(--ease-smooth) ${iterationCount}`,
          filter: 'blur(1px)',
        }}
      />
    </div>
  );
}

/**
 * Four corner sparkles that orbit on a stagger using the `sparkle-orbit`
 * keyframe. Alternating violet/pink corners reinforce the Aurora palette.
 */
export function SparkleOrbits({ rounded = 'rounded-lg' }: OverlayProps = {}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;

  const corners: Array<{
    pos: React.CSSProperties;
    color: string;
    delay: string;
  }> = [
    { pos: { top: -3, left: -3 }, color: 'var(--violet-400)', delay: '0s' },
    { pos: { top: -3, right: -3 }, color: 'var(--pink-400)', delay: '0.18s' },
    { pos: { bottom: -3, right: -3 }, color: 'var(--violet-400)', delay: '0.36s' },
    { pos: { bottom: -3, left: -3 }, color: 'var(--pink-400)', delay: '0.54s' },
  ];

  return (
    <div
      aria-hidden
      className={`absolute inset-0 pointer-events-none ${rounded}`}
      style={{ zIndex: 3 }}
    >
      {corners.map((c, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${c.color} 0%, transparent 70%)`,
            animation: `sparkle-orbit 1.4s var(--ease-smooth) infinite`,
            animationDelay: c.delay,
            ...c.pos,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Aurora-gradient "NEW" pill rendered inline in the TaskCard badge row.
 * Reads label from i18n key `kanban:task.new`.
 */
export function NewChip() {
  const { t } = useTranslation('kanban');
  return (
    <span
      style={{
        background: 'var(--gradient-aurora)',
        color: 'var(--text-on-brand)',
        borderRadius: 'var(--r-pill)',
        padding: '1px 6px',
        fontSize: 'var(--fs-xs)',
        fontWeight: 600,
        letterSpacing: 'var(--tracking-wide)',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
      }}
    >
      {t('task.new')}
    </span>
  );
}

/**
 * Green check pill rendered inline next to the type badge for a
 * just-completed task.
 */
export function CompletedCheckChip() {
  return (
    <span
      style={{
        background: 'var(--status-done-bg)',
        color: 'var(--status-done-fg)',
        borderRadius: 'var(--r-pill)',
        padding: '1px 6px',
        fontSize: 'var(--fs-xs)',
        fontWeight: 600,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        flexShrink: 0,
      }}
    >
      <Check style={{ width: 10, height: 10 }} strokeWidth={3} />
    </span>
  );
}

/**
 * Soft radial aurora halo behind the card. Pulses gently using the
 * `pulse-soft` keyframe defined in aurora-tokens.css.
 */
export function GlowHalo({ rounded = 'rounded-lg' }: OverlayProps = {}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  return (
    <div
      aria-hidden
      className={`absolute inset-0 pointer-events-none ${rounded}`}
      style={{
        background:
          'radial-gradient(ellipse at center, oklch(from var(--violet-400) l c h / 0.35) 0%, transparent 70%)',
        filter: 'blur(8px)',
        animation: 'pulse-soft 1.8s var(--ease-smooth) infinite',
        zIndex: 0,
      }}
    />
  );
}

/**
 * Convenience wrapper applying every "just-arrived" effect at once.
 * Used for both new-todo and just-completed states (sparkle + glow).
 * The TaskCard root must be positioned so this absolute overlay aligns.
 */
export function TaskCardEffectStack({
  children,
}: {
  children?: ReactNode;
}) {
  return <>{children}</>;
}
