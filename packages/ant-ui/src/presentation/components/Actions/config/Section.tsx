import type { ReactNode } from 'react';
import { HintBadge } from '@/presentation/components/common/HintBadge';
import type { HintBadgeProps } from '@/presentation/components/common/HintBadge';

interface SectionProps {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  iconColor?: string;
  hint?: Pick<HintBadgeProps, 'label' | 'tooltip' | 'colorScheme'>;
  children: ReactNode;
}

export function Section({ title, icon: Icon, iconColor, hint, children }: SectionProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
        {Icon && <Icon className={`w-3.5 h-3.5 ${iconColor || 'text-gray-400'}`} />}
        {title}
        {hint && <HintBadge label={hint.label} tooltip={hint.tooltip} colorScheme={hint.colorScheme} />}
      </h3>
      {children}
    </div>
  );
}
