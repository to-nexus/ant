import { useState, type ReactNode } from 'react';
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

  const [rootHover, setRootHover] = useState(false);
  const [closeHover, setCloseHover] = useState(false);

  const rootStyle: React.CSSProperties = isActive
    ? {
        position: 'relative',
        background: 'var(--bg-surface)',
        color: 'var(--violet-700)',
        border: '1px solid var(--violet-200)',
        boxShadow: 'var(--shadow-xs)',
        borderRadius: 'var(--r-sm) var(--r-sm) 0 0',
      }
    : {
        position: 'relative',
        background: rootHover ? 'var(--bg-hover)' : 'transparent',
        color: 'var(--text-3)',
        border: '1px solid transparent',
      };

  const closeStyle: React.CSSProperties = closeHover
    ? { background: 'var(--bg-hover)', color: 'var(--text-1)' }
    : { color: 'var(--text-3)' };

  return (
    <div
      className={cn(
        'relative flex items-center gap-2 py-1.5 rounded-t text-sm font-medium',
        showText ? 'px-3' : 'px-2 min-w-[36px] min-h-[36px] justify-center',
        truncateLabel && showText && 'max-w-[300px] min-w-0',
        !isActive && 'cursor-pointer',
      )}
      style={rootStyle}
      data-state={isActive ? 'active' : 'idle'}
      title={title}
      onClick={onClick}
      onMouseEnter={() => !isActive && setRootHover(true)}
      onMouseLeave={() => setRootHover(false)}
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
          onMouseEnter={() => setCloseHover(true)}
          onMouseLeave={() => setCloseHover(false)}
          className={cn(
            'p-0.5 rounded',
            !showText && 'hidden',
          )}
          style={closeStyle}
          title={t('tabs.closeTab', { label: label.toLowerCase() })}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      {isActive && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '1px',
            background: 'var(--violet-500)',
          }}
        />
      )}
    </div>
  );
}
