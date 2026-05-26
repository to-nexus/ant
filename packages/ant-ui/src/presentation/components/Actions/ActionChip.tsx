
import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import type { IntentGroup, ActionReadiness } from '@ant/shared';
import { ACTION_VISUALS } from './actionVisuals';

/**
 * ActionChip — Aurora postcard tile (large) / compact row (chat).
 *
 * Two variants share one props shape:
 * - `large`   : 88-px-min postcard tile with full-bleed gradient, 108-px
 *               watermark icon (opacity 0.18), ±0.25° rest rotation,
 *               hover translateY(-3px) + glass mini-arrow.
 * - `compact` : 34-px gradient orb + label/description row, used inside
 *               ChatActionCards.
 *
 * Gradient table per visual handoff `c1-data.jsx` ACTION_TINTS — one
 * per IntentGroup. When `actionId` is omitted (intent-level chips), the
 * caller's `iconBg`/`iconColor` overrides apply.
 */

const ACTION_GRADIENTS: Record<IntentGroup, { gradient: string; hue: number }> = {
  plan: {
    gradient: 'linear-gradient(135deg, oklch(70% 0.18 240), oklch(76% 0.15 215))',
    hue: 240,
  },
  'design-system': {
    gradient: 'linear-gradient(135deg, oklch(64% 0.24 285), oklch(70% 0.22 295))',
    hue: 285,
  },
  'design-ui': {
    gradient: 'linear-gradient(135deg, oklch(70% 0.22 340), oklch(74% 0.20 355))',
    hue: 340,
  },
  'design-game-art': {
    gradient: 'linear-gradient(135deg, oklch(78% 0.16 85), oklch(82% 0.14 95))',
    hue: 85,
  },
  'design-spec': {
    gradient: 'linear-gradient(135deg, oklch(68% 0.22 15), oklch(72% 0.20 25))',
    hue: 20,
  },
  code: {
    gradient: 'linear-gradient(135deg, oklch(70% 0.18 155), oklch(76% 0.16 170))',
    hue: 155,
  },
  visual: {
    gradient: 'linear-gradient(135deg, oklch(68% 0.22 295), oklch(74% 0.18 310))',
    hue: 295,
  },
  'learn-codebase': {
    gradient: 'linear-gradient(135deg, oklch(78% 0.16 85), oklch(82% 0.14 95))',
    hue: 85,
  },
  ask: {
    gradient: 'linear-gradient(135deg, oklch(72% 0.16 200), oklch(76% 0.14 215))',
    hue: 200,
  },
};

const FALLBACK_GRADIENT = {
  gradient: 'var(--gradient-violet-pink)',
  hue: 295,
};

export interface ActionChipProps {
  label: string;
  description: string;
  variant: 'compact' | 'large';
  onClick: () => void;
  /** When set, picks ACTION_GRADIENTS[actionId]; else uses iconBg/iconColor overrides. */
  actionId?: IntentGroup;
  readiness?: ActionReadiness;
  /** Override icon (intent-level chips). When `actionId` is set, ACTION_VISUALS[actionId].icon is used. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Override gradient/colors (intent-level chips). */
  iconBg?: string;
  iconColor?: string;
  disabled?: boolean;
  blockReason?: string;
  /** Millisecond delay; parity (idx = delay/50) drives ±0.25° rest rotation. */
  animationDelay?: number;
}

export function ActionChip(props: ActionChipProps) {
  const {
    label,
    description,
    variant,
    onClick,
    actionId,
    icon,
    disabled = false,
    blockReason,
    animationDelay = 0,
  } = props;

  const visual = actionId ? ACTION_VISUALS[actionId] : undefined;
  const IconCmp = icon ?? visual?.icon;
  const grad = actionId ? ACTION_GRADIENTS[actionId] : FALLBACK_GRADIENT;
  const idx = Math.round(animationDelay / 50);
  const restRotation = idx % 2 === 0 ? -0.25 : 0.25;

  if (variant === 'large') {
    return (
      <LargeTile
        label={label}
        description={description}
        onClick={onClick}
        IconCmp={IconCmp}
        gradient={grad.gradient}
        hue={grad.hue}
        disabled={disabled}
        blockReason={blockReason}
        restRotation={restRotation}
        animationDelay={animationDelay}
      />
    );
  }

  return (
    <CompactRow
      label={label}
      description={description}
      onClick={onClick}
      IconCmp={IconCmp}
      gradient={grad.gradient}
      hue={grad.hue}
      disabled={disabled}
      blockReason={blockReason}
      animationDelay={animationDelay}
    />
  );
}

/* ============================================================
 *  Large variant — postcard tile
 * ============================================================ */

interface LargeTileProps {
  label: string;
  description: string;
  onClick: () => void;
  IconCmp?: React.ComponentType<{ className?: string }>;
  gradient: string;
  hue: number;
  disabled: boolean;
  blockReason?: string;
  restRotation: number;
  animationDelay: number;
}

function LargeTile({
  label,
  description,
  onClick,
  IconCmp,
  gradient,
  hue,
  disabled,
  blockReason,
  restRotation,
  animationDelay,
}: LargeTileProps) {
  const [hover, setHover] = React.useState(false);
  const active = hover && !disabled;

  const rootStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    minHeight: 88,
    borderRadius: 16,
    padding: '14px 16px 12px',
    background: gradient,
    backgroundSize: '180% 180%',
    backgroundPosition: active ? '100% 100%' : '0% 0%',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    overflow: 'hidden',
    textAlign: 'left',
    color: 'white',
    opacity: disabled ? 0.4 : 1,
    transform: active
      ? `translateY(-3px) rotate(${restRotation * 0.4}deg) scale(1.012)`
      : `translateY(0) rotate(${restRotation}deg) scale(1)`,
    boxShadow: active
      ? `0 22px 36px -12px oklch(55% 0.24 ${hue} / 0.65), inset 0 0 0 1px oklch(100% 0 0 / 0.18), inset 0 1px 0 0 oklch(100% 0 0 / 0.20)`
      : `0 14px 28px -12px oklch(55% 0.24 ${hue} / 0.55), inset 0 0 0 1px oklch(100% 0 0 / 0.18), inset 0 1px 0 0 oklch(100% 0 0 / 0.20)`,
    transition:
      'transform 360ms var(--ease-spring), box-shadow 360ms var(--ease-smooth), background-position 600ms var(--ease-smooth), opacity 320ms var(--ease-smooth)',
    animation: `spring-in 420ms var(--ease-spring) ${animationDelay}ms forwards`,
    animationDelay: `${animationDelay}ms`,
    isolation: 'isolate',
  };

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      style={rootStyle}
      aria-label={label}
      title={disabled ? blockReason : undefined}
    >
      {/* Dot pattern overlay */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'radial-gradient(circle at 1px 1px, oklch(100% 0 0 / 0.06) 1px, transparent 0)',
          backgroundSize: '12px 12px',
          mixBlendMode: 'overlay',
          pointerEvents: 'none',
        }}
      />

      {/* Top-right glass halo */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: -20,
          right: -20,
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: 'oklch(100% 0 0 / 0.12)',
          filter: 'blur(4px)',
          pointerEvents: 'none',
        }}
      />

      {/* Bottom-right watermark icon */}
      {IconCmp && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: -14,
            bottom: -22,
            width: 108,
            height: 108,
            color: 'oklch(100% 0 0 / 0.18)',
            transform: active
              ? 'rotate(-8deg) scale(1.08)'
              : 'rotate(-4deg) scale(1)',
            transition: 'transform 420ms var(--ease-spring)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconCmp className="w-[108px] h-[108px]" />
        </span>
      )}

      {/* Top-right glass mini arrow (hover) */}
      {!disabled && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'oklch(100% 0 0 / 0.25)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            opacity: active ? 1 : 0,
            transform: active
              ? 'translate(0, 0) scale(1)'
              : 'translate(6px, -4px) scale(0.5)',
            transition:
              'opacity 220ms var(--ease-smooth), transform 280ms var(--ease-spring)',
            pointerEvents: 'none',
          }}
        >
          <ArrowRight size={11} strokeWidth={2.5} />
        </span>
      )}

      {/* Foreground content */}
      <span
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          paddingRight: 60,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            fontWeight: 800,
            color: 'white',
            letterSpacing: '-0.02em',
            textShadow: '0 2px 6px oklch(0% 0 0 / 0.20)',
            lineHeight: 1.2,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11.5,
            lineHeight: 1.35,
            color: 'oklch(100% 0 0 / 0.88)',
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
          }}
        >
          {description}
        </span>
        {disabled && blockReason && (
          <span
            style={{
              fontSize: 10.5,
              color: 'oklch(100% 0 0 / 0.92)',
              marginTop: 2,
              fontWeight: 600,
            }}
          >
            {blockReason}
          </span>
        )}
      </span>
    </button>
  );
}

/* ============================================================
 *  Compact variant — chat panel row
 * ============================================================ */

interface CompactRowProps {
  label: string;
  description: string;
  onClick: () => void;
  IconCmp?: React.ComponentType<{ className?: string }>;
  gradient: string;
  hue: number;
  disabled: boolean;
  blockReason?: string;
  animationDelay: number;
}

function CompactRow({
  label,
  description,
  onClick,
  IconCmp,
  gradient,
  hue,
  disabled,
  blockReason,
  animationDelay,
}: CompactRowProps) {
  const [hover, setHover] = React.useState(false);
  const active = hover && !disabled;

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      style={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 'var(--r-xl)',
        background: 'var(--bg-surface)',
        border: `1.5px solid ${active ? `oklch(75% 0.10 ${hue})` : 'var(--border-2)'}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.4 : 1,
        transform: active ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: active
          ? `0 6px 16px -8px oklch(60% 0.22 ${hue} / 0.4)`
          : 'none',
        transition:
          'transform 220ms var(--ease-spring), box-shadow 220ms var(--ease-smooth), border-color 220ms var(--ease-smooth)',
        animation: `spring-in 320ms var(--ease-spring) ${animationDelay}ms backwards`,
      }}
      aria-label={label}
      title={disabled ? blockReason : undefined}
    >
      {/* Gradient orb with icon */}
      <span
        aria-hidden
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: gradient,
          backgroundSize: '180% 180%',
          backgroundPosition: active ? '100% 100%' : '0% 0%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          boxShadow: `0 4px 10px -4px oklch(60% 0.22 ${hue} / 0.4)`,
          transform: active ? 'scale(1.08) rotate(-3deg)' : 'scale(1) rotate(0)',
          transition:
            'transform 260ms var(--ease-spring), background-position 480ms var(--ease-smooth)',
          color: 'white',
        }}
      >
        {IconCmp && <IconCmp className="w-[17px] h-[17px]" />}
      </span>

      {/* Text */}
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text-1)',
            lineHeight: 1.25,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            lineHeight: 1.4,
            color: disabled && blockReason ? 'var(--amber-600)' : 'var(--text-3)',
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 1,
            overflow: 'hidden',
          }}
        >
          {disabled && blockReason ? blockReason : description}
        </span>
      </span>
    </button>
  );
}
