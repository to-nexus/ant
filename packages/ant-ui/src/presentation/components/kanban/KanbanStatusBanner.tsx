import { ReactNode } from 'react';

export type BannerVariant = 'info' | 'warning' | 'error' | 'success' | 'processing';

interface KanbanStatusBannerProps {
  variant: BannerVariant;
  icon: ReactNode;  // ✅ ReactNode로 변경하여 아이콘 컴포넌트 지원
  title: string;
  message?: string;
  children?: ReactNode;  // 추가 콘텐츠 (버튼, 스켈레톤 등)
  compact?: boolean;  // 높이 축소 여부
}

/**
 * Get display styling for each variant
 */
function getVariantStyles(variant: BannerVariant): {
  bg: string;
  border: string;
  title: string;
  text: string;
} {
  switch (variant) {
    case 'info':
      return {
        bg: 'var(--bg-surface)',
        border: 'var(--border-1)',
        title: 'var(--violet-500)',
        text: 'var(--text-2)',
      };
    case 'warning':
      return {
        bg: 'var(--bg-surface)',
        border: 'var(--border-1)',
        title: 'var(--orange-500)',
        text: 'var(--text-2)',
      };
    case 'error':
      return {
        bg: 'var(--bg-surface)',
        border: 'var(--border-1)',
        title: 'var(--red-500)',
        text: 'var(--text-2)',
      };
    case 'success':
      return {
        bg: 'var(--bg-surface)',
        border: 'var(--border-1)',
        title: 'var(--status-done-fg)',
        text: 'var(--text-2)',
      };
    case 'processing':
      return {
        bg: 'var(--bg-surface)',
        border: 'var(--border-1)',
        title: 'var(--violet-500)',
        text: 'var(--text-2)',
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
    <div
      className={`mb-4 ${paddingClass} rounded-lg`}
      style={{
        background: styles.bg,
        border: `2px solid ${styles.border}`,
      }}
    >
      <div className="flex items-start gap-4">
        <div className={iconSize}>{icon}</div>
        <div className="flex-1 min-w-0">
          <div
            className={`font-semibold ${titleSize} mb-2`}
            style={{ color: styles.title }}
          >
            {title}
          </div>
          {message && (
            <div
              className={`text-sm ${children ? 'mb-3' : ''}`}
              style={{ color: styles.text }}
            >
              {message}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}


