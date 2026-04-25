export type TierVariant = 'techTier' | 'visualTier' | 'artTier' | 'gameContentTier';

export interface TierBadgeData {
  keyLabel: string;
  label: string;
  isChanged?: boolean;
  isAuto?: boolean;
}

interface TierBadgeProps {
  badge: TierBadgeData;
  variant: TierVariant;
}

const AUTO_STYLE = 'bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700 italic';
const CHANGED_STYLE = 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700';

const VARIANT_STYLES: Record<TierVariant, {
  normal: string;
  auto: string;
  changed: string;
  keyColor: string;
}> = {
  techTier: {
    normal: 'bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700/60',
    auto: AUTO_STYLE,
    changed: CHANGED_STYLE,
    keyColor: 'text-violet-400 dark:text-violet-500',
  },
  visualTier: {
    normal: 'bg-pink-50 dark:bg-pink-950/20 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-700/60',
    auto: AUTO_STYLE,
    changed: CHANGED_STYLE,
    keyColor: 'text-pink-400 dark:text-pink-500',
  },
  artTier: {
    normal: 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700/60',
    auto: AUTO_STYLE,
    changed: CHANGED_STYLE,
    keyColor: 'text-amber-400 dark:text-amber-500',
  },
  gameContentTier: {
    normal: 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700/60',
    auto: AUTO_STYLE,
    changed: CHANGED_STYLE,
    keyColor: 'text-emerald-400 dark:text-emerald-500',
  },
};

export function TierBadge({ badge, variant }: TierBadgeProps) {
  const styles = VARIANT_STYLES[variant];
  const cls = badge.isAuto
    ? styles.auto
    : badge.isChanged
      ? styles.changed
      : styles.normal;
  const keyCls = badge.isAuto ? 'text-gray-400 dark:text-gray-500' : styles.keyColor;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] shrink-0 border ${cls}`}
    >
      <span className={`font-normal ${keyCls}`}>{badge.keyLabel}:</span>
      <span className="ml-1 font-medium">{badge.label}</span>
      {badge.isChanged && <span className="ml-1 text-[9px] text-amber-500">*</span>}
    </span>
  );
}
