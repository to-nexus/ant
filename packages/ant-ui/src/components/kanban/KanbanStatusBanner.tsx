import { ReactNode } from 'react';

export type BannerVariant = 'info' | 'warning' | 'error' | 'success' | 'processing';

interface KanbanStatusBannerProps {
  variant: BannerVariant;
  icon: string;
  title: string;
  message?: string;
  children?: ReactNode;  // 추가 콘텐츠 (버튼, 스켈레톤 등)
  compact?: boolean;  // 높이 축소 여부
}

/**
 * Get display styling for each variant
 */
function getVariantStyles(variant: BannerVariant) {
  switch (variant) {
    case 'info':
      return {
        bgClass: 'bg-blue-50 dark:bg-blue-950',
        borderClass: 'border-blue-300 dark:border-blue-700',
        titleClass: 'text-blue-900 dark:text-blue-200',
        textClass: 'text-blue-800 dark:text-blue-300'
      };
    case 'warning':
      return {
        bgClass: 'bg-orange-50 dark:bg-orange-950',
        borderClass: 'border-orange-300 dark:border-orange-700',
        titleClass: 'text-orange-900 dark:text-orange-200',
        textClass: 'text-orange-800 dark:text-orange-300'
      };
    case 'error':
      return {
        bgClass: 'bg-red-50 dark:bg-red-950',
        borderClass: 'border-red-300 dark:border-red-700',
        titleClass: 'text-red-900 dark:text-red-200',
        textClass: 'text-red-800 dark:text-red-300'
      };
    case 'success':
      return {
        bgClass: 'bg-green-50 dark:bg-green-950',
        borderClass: 'border-green-300 dark:border-green-700',
        titleClass: 'text-green-900 dark:text-green-200',
        textClass: 'text-green-800 dark:text-green-300'
      };
    case 'processing':
      return {
        bgClass: 'bg-purple-50 dark:bg-purple-950',
        borderClass: 'border-purple-300 dark:border-purple-700',
        titleClass: 'text-purple-900 dark:text-purple-200',
        textClass: 'text-purple-800 dark:text-purple-300'
      };
  }
}

/**
 * KanbanStatusBanner - Unified status banner component
 * 
 * Used for:
 * - Interruption prompts (user_stopped, recursion_limit, errors)
 * - Processing states (estimating, decomposing)
 * - Any other status that needs user attention
 */
export function KanbanStatusBanner({
  variant,
  icon,
  title,
  message,
  children,
  compact = false
}: KanbanStatusBannerProps) {
  const styles = getVariantStyles(variant);
  const paddingClass = compact ? 'p-4' : 'p-6';
  const iconSize = compact ? 'text-2xl' : 'text-3xl';
  const titleSize = compact ? 'text-base' : 'text-lg';
  
  return (
    <div className={`mb-4 ${paddingClass} ${styles.bgClass} border-2 ${styles.borderClass} rounded-lg`}>
      <div className="flex items-start gap-4">
        <div className={iconSize}>{icon}</div>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold ${titleSize} ${styles.titleClass} mb-2`}>
            {title}
          </div>
          {message && (
            <div className={`text-sm ${styles.textClass} ${children ? 'mb-3' : ''}`}>
              {message}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}


