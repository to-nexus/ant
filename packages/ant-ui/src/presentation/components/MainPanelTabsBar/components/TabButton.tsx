import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X, LucideIcon } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';

interface TabButtonProps {
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  isJobTab?: boolean;
  /**
   * When true, the label uses a capped width with ellipsis (file editor tabs).
   */
  truncateLabel?: boolean;
  /**
   * Optional inline trailing element (e.g. the JobIdDropdown trigger on the
   * job tab). Replaces the legacy `jobId` + `onCopyJobId` props — copy /
   * delete are now per-row actions inside the dropdown, not on the tab.
   */
  trailing?: ReactNode;
  showText?: boolean;
  showTrailingWhenCollapsed?: boolean;
  showCloseButton?: boolean;
  title?: string;
  onClick: () => void;
  onClose?: () => void;
}

/**
 * Tab button used by the main panel tabs bar.
 *
 * The job tab no longer renders an X button or a copy-on-click chip.
 * Job-tab actions (switch jobId, copy jobId, delete jobId) live inside
 * the `JobIdDropdown` injected via the `trailing` slot.
 */
export function TabButton({
  icon: Icon,
  label,
  isActive,
  isJobTab = false,
  truncateLabel = false,
  trailing,
  showText = true,
  showTrailingWhenCollapsed = false,
  showCloseButton = false,
  title,
  onClick,
  onClose,
}: TabButtonProps) {
  const { t } = useTranslation('nav');
  const truncatedLabelStyle = truncateLabel
    ? {
        // Ellipsis(...) 대신 우측으로 갈수록 사라지는 페이드 처리.
        WebkitMaskImage: 'linear-gradient(to right, black 0%, black 82%, transparent 100%)',
        maskImage: 'linear-gradient(to right, black 0%, black 82%, transparent 100%)',
      }
    : undefined;
  // The job tab's "remove" surface moved into the dropdown's per-row trash
  // icon. Force-suppress the X button here regardless of the prop value so
  // no caller can re-introduce a tab-level reset.
  const showCloseButtonEffective = showCloseButton && !isJobTab;
  return (
    <div
      className={cn(
        'flex items-center gap-2 py-1.5 rounded-t text-sm font-medium',
        showText ? 'px-3' : 'px-2 min-w-[36px] min-h-[36px] justify-center',
        truncateLabel && showText && 'max-w-[300px] min-w-0',
        isActive
          ? 'bg-white dark:bg-[#0d1117] text-gray-900 dark:text-white border-t border-x border-gray-200 dark:border-[#30363d]'
          : 'bg-gray-100 dark:bg-[#161b22] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#1c2128] cursor-pointer'
      )}
      title={title}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Icon className="w-4 h-4 flex-shrink-0" />
        {showText && (
          <span
            className={cn(
              isJobTab && 'whitespace-nowrap',
              truncateLabel &&
                'min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[10px] font-mono font-normal leading-tight',
            )}
            style={truncatedLabelStyle}
          >
            {label}
          </span>
        )}
        {(showText || showTrailingWhenCollapsed) && trailing && (
          <span className="flex-shrink-0">{trailing}</span>
        )}
      </div>
      {showCloseButtonEffective && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
          className={cn(
            'p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
            !showText && 'hidden'
          )}
          title={t('tabs.closeTab', { label: label.toLowerCase() })}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
