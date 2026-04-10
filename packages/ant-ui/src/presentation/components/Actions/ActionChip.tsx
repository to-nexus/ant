import { ACTION_VISUALS, type VisualDef } from './actionVisuals';
import type { ActionId, ActionReadiness } from '@ant/shared';

export { ACTION_VISUALS };

// ============================================
// Props — variation is controlled here
// ============================================

interface ActionChipProps {
  label: string;
  description: string;
  variant: 'compact' | 'large';
  onClick: () => void;
  animationDelay?: number;

  /** Lookup-based: resolve icon/bg/text from ACTION_VISUALS */
  actionId?: ActionId;
  readiness?: ActionReadiness;

  /** Direct injection: override or supply icon/bg/text explicitly */
  icon?: React.ComponentType<{ className?: string }>;
  iconBg?: string;
  iconColor?: string;

  /** Disabled state (intent cards with block reasons) */
  disabled?: boolean;
  blockReason?: string;
}

// ============================================
// Component
// ============================================

export function ActionChip({
  label, description, variant, onClick, animationDelay = 0,
  actionId, icon, iconBg, iconColor,
  disabled, blockReason,
}: ActionChipProps) {
  const looked: VisualDef | undefined = actionId ? ACTION_VISUALS[actionId] : undefined;
  const Icon = icon ?? looked?.icon;
  const bg = iconBg ?? looked?.bg ?? '';
  const text = iconColor ?? looked?.text ?? '';

  if (!Icon) return null;

  const isLarge = variant === 'large';

  return (
    <>
      {/* Full card — hidden below @xs (icon-only tier) */}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`
          action-chip relative overflow-hidden w-full h-full
          rounded-2xl border border-gray-200 dark:border-[#30363d]
          bg-white dark:bg-gray-800/50
          transition-all duration-200 text-left group
          hidden @xs:block
          ${isLarge ? 'px-5 py-4' : 'px-4 py-3'}
          ${disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'cursor-pointer hover:shadow-lg hover:border-gray-300 dark:hover:border-gray-500 hover:scale-[1.02] active:scale-[0.98]'}
        `}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        {!disabled && (
          <div className="action-chip-glow absolute inset-[-1px] rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        )}

        <div className="relative flex items-center gap-3">
          <div className={`
            ${isLarge ? 'w-10 h-10' : 'w-9 h-9'}
            rounded-xl flex items-center justify-center shrink-0
            ${bg}
            group-hover:scale-105 transition-transform duration-200
          `}>
            <Icon className={`${isLarge ? 'w-5 h-5' : 'w-4 h-4'} ${text}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`${isLarge ? 'text-sm' : 'text-xs'} font-semibold text-gray-800 dark:text-gray-200 truncate`}>
                {label}
              </span>
            </div>
            {isLarge && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{description}</p>
            )}
            {disabled && blockReason && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{blockReason}</p>
            )}
          </div>
        </div>
      </button>

      {/* Icon-only — visible only below @xs */}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`
          @xs:hidden
          w-11 h-11 rounded-xl flex items-center justify-center
          border border-gray-200 dark:border-[#30363d]
          bg-white dark:bg-gray-800/50
          transition-all duration-200 group
          ${bg}
          ${disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'cursor-pointer hover:shadow-md hover:scale-105 active:scale-95'}
        `}
        title={label}
        style={{ animationDelay: `${animationDelay}ms` }}
      >
        <Icon className={`w-5 h-5 ${text}`} />
      </button>
    </>
  );
}
