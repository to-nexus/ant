import { Lock } from 'lucide-react';

export type TierVariant = 'techTier' | 'visualTier' | 'gameArtTier' | 'gameContentTier';

export interface TierBadgeData {
  keyLabel: string;
  label: string;
  isChanged?: boolean;
  isAuto?: boolean;
  /**
   * Locked badges represent values pinned by the intent matrix
   * (`BasisSlotConfig.lockedStack`). Render a lock affordance and
   * suppress edit / reset chrome that would suggest user mutation.
   */
  isLocked?: boolean;
}

interface TierBadgeProps {
  badge: TierBadgeData;
  variant: TierVariant;
}

const AUTO_STYLE: React.CSSProperties = {
  background: 'var(--bg-surface-2)',
  color: 'var(--text-3)',
  border: '1px solid var(--border-2)',
  fontStyle: 'italic',
};

const CHANGED_STYLE: React.CSSProperties = {
  background: 'oklch(95% 0.06 70)',
  color: 'oklch(45% 0.16 70)',
  border: '1px solid oklch(88% 0.08 70)',
};

const VARIANT_STYLES: Record<TierVariant, {
  normal: React.CSSProperties;
  keyColor: string;
}> = {
  techTier: {
    normal: {
      background: 'oklch(96% 0.04 285)',
      color: 'var(--violet-700)',
      border: '1px solid oklch(88% 0.06 285)',
    },
    keyColor: 'oklch(70% 0.10 285)',
  },
  visualTier: {
    normal: {
      background: 'oklch(96% 0.04 340)',
      color: 'var(--pink-700)',
      border: '1px solid oklch(88% 0.06 340)',
    },
    keyColor: 'oklch(70% 0.10 340)',
  },
  gameArtTier: {
    normal: {
      background: 'oklch(96% 0.05 85)',
      color: 'oklch(45% 0.16 85)',
      border: '1px solid oklch(88% 0.08 85)',
    },
    keyColor: 'oklch(70% 0.10 85)',
  },
  gameContentTier: {
    normal: {
      background: 'oklch(96% 0.05 155)',
      color: 'oklch(40% 0.14 155)',
      border: '1px solid oklch(88% 0.08 155)',
    },
    keyColor: 'oklch(60% 0.10 155)',
  },
};

export function TierBadge({ badge, variant }: TierBadgeProps) {
  const styles = VARIANT_STYLES[variant];
  const baseStyle: React.CSSProperties = badge.isAuto
    ? AUTO_STYLE
    : badge.isChanged
      ? CHANGED_STYLE
      : styles.normal;

  const finalStyle: React.CSSProperties = {
    ...baseStyle,
    ...(badge.isLocked
      ? { boxShadow: 'inset 0 0 0 1px var(--border-3)' }
      : {}),
  };

  const keyColor = badge.isAuto ? 'var(--text-3)' : styles.keyColor;

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] shrink-0"
      style={finalStyle}
      title={badge.isLocked ? 'Locked by intent' : undefined}
    >
      {badge.isLocked && (
        <Lock
          className="w-2.5 h-2.5 mr-1"
          style={{ opacity: 0.85 }}
          aria-hidden
        />
      )}
      <span className="font-normal" style={{ color: keyColor }}>{badge.keyLabel}:</span>
      <span className="ml-1 font-medium">{badge.label}</span>
      {/* Locked rows suppress the changed `*` indicator (matrix-pinned value cannot be "changed"). */}
      {badge.isChanged && !badge.isLocked && (
        <span className="ml-1 text-[9px]" style={{ color: 'oklch(60% 0.18 70)' }}>*</span>
      )}
    </span>
  );
}
