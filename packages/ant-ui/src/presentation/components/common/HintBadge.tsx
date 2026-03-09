import React from 'react';
import { Info } from 'lucide-react';
import { Tooltip } from './Tooltip';

type ColorScheme = 'gray' | 'purple' | 'amber';

const colorStyles: Record<ColorScheme, { badge: string; icon: string }> = {
  gray: {
    badge: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
    icon: 'text-gray-400 dark:text-gray-500',
  },
  purple: {
    badge: 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300',
    icon: 'text-purple-400 dark:text-purple-400',
  },
  amber: {
    badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    icon: 'text-amber-500 dark:text-amber-400',
  },
};

export interface HintBadgeProps {
  label: string;
  tooltip: string;
  isCompact?: boolean;
  colorScheme?: ColorScheme;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * Responsive hint badge: shows a short label (wide) or an info icon (narrow),
 * with a click-triggered tooltip for the full description.
 */
export const HintBadge: React.FC<HintBadgeProps> = ({
  label,
  tooltip,
  isCompact = false,
  colorScheme = 'gray',
  placement = 'right',
}) => {
  const colors = colorStyles[colorScheme];

  return (
    <Tooltip content={tooltip} placement={placement}>
      <span className={`inline-flex items-center justify-center h-4 flex-shrink-0 rounded ${isCompact ? 'w-4' : `px-1 font-medium text-[10px] ${colors.badge}`}`}>
        {isCompact ? (
          <Info className={`w-3 h-3 ${colors.icon}`} />
        ) : (
          label
        )}
      </span>
    </Tooltip>
  );
};
