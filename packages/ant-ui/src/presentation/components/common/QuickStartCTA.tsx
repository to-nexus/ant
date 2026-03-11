import { Sparkles } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';

interface QuickStartCTAProps {
  title: string;
  hint: string;
  onClick: () => void;
  variant?: 'project' | 'feature';
  className?: string;
}

const variantStyles = {
  project: {
    button: cn(
      'bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30',
      'border border-emerald-200 dark:border-emerald-800/50 rounded-xl',
      'text-sm text-emerald-700 dark:text-emerald-300',
      'hover:from-emerald-100 hover:to-teal-100 dark:hover:from-emerald-950/50 dark:hover:to-teal-950/50',
    ),
    iconWrapper: 'bg-emerald-100 dark:bg-emerald-900/40',
    icon: 'text-emerald-600 dark:text-emerald-400',
    hint: 'text-emerald-600/70 dark:text-emerald-400/70',
  },
  feature: {
    button: cn(
      'bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30',
      'border border-indigo-200/60 dark:border-indigo-800/40 rounded-xl',
      'text-sm text-indigo-700 dark:text-indigo-300',
      'hover:border-indigo-300 dark:hover:border-indigo-700',
    ),
    iconWrapper: 'bg-indigo-100 dark:bg-indigo-900/40',
    icon: 'text-indigo-500 dark:text-indigo-400',
    hint: 'text-indigo-500/70 dark:text-indigo-400/60',
  },
} as const;

export function QuickStartCTA({
  title,
  hint,
  onClick,
  variant = 'project',
  className,
}: QuickStartCTAProps) {
  const styles = variantStyles[variant];

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-3 text-left',
        'hover:shadow-sm transition-all duration-200 group',
        styles.button,
        className,
      )}
    >
      <div className={cn(
        'flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0',
        'group-hover:scale-105 transition-transform',
        styles.iconWrapper,
      )}>
        <Sparkles className={cn('w-4 h-4', styles.icon)} />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <div className="font-medium">{title}</div>
        <div className={cn('text-xs mt-0.5 truncate', styles.hint)}>
          {hint}
        </div>
      </div>
    </button>
  );
}
