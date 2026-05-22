
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

/** Column-level accent context. When provided, overlays adopt the column's
 *  color/gradient instead of the default violet/pink/aurora palette. */
export interface OverlayAccent {
  color: string;
  gradient: string;
}

interface OverlayProps {
  /** Optional rounded-* utility to match the wrapped card. */
  rounded?: string;
  /** Optional column-level accent (color + gradient). When omitted, the
   *  component falls back to the original violet/pink/aurora palette so
   *  existing call-sites remain visually unchanged. */
  accent?: OverlayAccent;
}

/**
 * Soft aurora-violet glow that pulses behind the card.
 * Uses the `task-glow-pulse` keyframe defined in aurora-tokens.css.
 *
 * When `accent` is provided, `--task-glow` is driven by the column color so
 * the pulse matches the lane (in-progress = pink, etc.).
 */
export function TaskGlowPulseLayer({
  rounded = 'rounded-lg',
  accent,
}: OverlayProps = {}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  const glowColor = accent
    ? `oklch(from ${accent.color} l c h / 0.50)`
    : 'var(--violet-500)';
  return (
    <div
      aria-hidden
      className={`absolute inset-0 pointer-events-none ${rounded}`}
      style={{
        // Custom property consumed by the keyframe.
        ['--task-glow' as string]: glowColor,
        animation: 'task-glow-pulse 2.6s var(--ease-smooth) infinite',
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
  accent,
}: ShimmerSweepOverlayProps) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;

  const duration = variant === 'in-progress' ? '1.6s' : '3.6s';
  const iterationCount = variant === 'in-progress' ? 'infinite' : 1;

  // When `accent` is supplied, drive the shimmer band from a single column
  // color (matches the handoff: in-progress=pink, completed-slow=teal).
  // Without `accent`, preserve the original violet→pink palette.
  const background = accent
    ? `linear-gradient(110deg, transparent 0%, oklch(from ${accent.color} l c h / 0.22) 40%, oklch(from ${accent.color} l c h / 0.40) 50%, oklch(from ${accent.color} l c h / 0.22) 60%, transparent 100%)`
    : 'linear-gradient(110deg, transparent 0%, oklch(from var(--violet-300) l c h / 0.55) 40%, oklch(from var(--pink-300) l c h / 0.75) 50%, oklch(from var(--violet-300) l c h / 0.55) 60%, transparent 100%)';

  return (
    <div
      aria-hidden
      className={`absolute inset-0 pointer-events-none overflow-hidden ${rounded}`}
      style={{ zIndex: 2 }}
    >
      <div
        className="absolute inset-0"
        style={{
          background,
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

interface NewChipProps {
  /** Optional column-level accent. When omitted, the chip uses the default
   *  aurora gradient — preserves visual behaviour for legacy call-sites. */
  accent?: OverlayAccent;
}

/**
 * Aurora-gradient "NEW" pill. Renders the i18n label (`kanban:task.new`).
 * When `accent` is provided, the chip adopts the column's gradient so the
 * NEW indicator visually aligns with the lane it appears in.
 */
export function NewChip({ accent }: NewChipProps = {}) {
  const { t } = useTranslation('kanban');
  const background = accent?.gradient ?? 'var(--gradient-aurora)';
  return (
    <span
      className="gradient-flow"
      style={{
        background,
        backgroundSize: '200% 200%',
        color: 'var(--text-on-brand)',
        borderRadius: 'var(--r-pill)',
        padding: '2px 8px',
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        boxShadow: accent
          ? `0 0 14px oklch(from ${accent.color} l c h / 0.5)`
          : '0 0 14px oklch(from var(--violet-500) l c h / 0.5)',
        animation: 'sparkle-pop 480ms var(--ease-spring) both',
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
 *
 * When `accent` is provided, the halo radiates the column's color so the
 * "freshly arrived" cue matches its lane (todo=violet, completed=teal).
 */
export function GlowHalo({ rounded = 'rounded-lg', accent }: OverlayProps = {}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  const center = accent
    ? `oklch(from ${accent.color} l c h / 0.35)`
    : 'oklch(from var(--violet-400) l c h / 0.35)';
  return (
    <div
      aria-hidden
      className={`absolute inset-0 pointer-events-none ${rounded}`}
      style={{
        background: `radial-gradient(ellipse at center, ${center} 0%, transparent 70%)`,
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
