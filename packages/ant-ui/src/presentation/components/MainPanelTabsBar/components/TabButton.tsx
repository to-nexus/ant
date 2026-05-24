import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X, LucideIcon } from 'lucide-react';
import { cn } from '@/shared/utils/design-system';

export type TabAccent =
  | 'aurora'
  | 'violet-pink'
  | 'pink-orange'
  | 'cool'
  | 'sunset';

const ACCENT_GRADIENTS: Record<TabAccent, string> = {
  aurora: 'var(--gradient-aurora)',
  'violet-pink': 'var(--gradient-violet-pink)',
  'pink-orange': 'var(--gradient-pink-orange)',
  cool: 'var(--gradient-cool)',
  sunset: 'var(--gradient-sunset)',
};

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
  /**
   * Accent gradient applied to the active-tab bottom indicator. Defaults to
   * `'aurora'` when omitted. Unknown values fall back to `'aurora'`.
   */
  accent?: TabAccent;
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
  accent = 'aurora',
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

  const accentGradient =
    ACCENT_GRADIENTS[accent] ?? ACCENT_GRADIENTS.aurora;

  const baseRootStyle: React.CSSProperties = {
    position: 'relative',
    border: '1px solid transparent',
    borderRadius: 'var(--r-sm)',
    padding: showText ? '6px 12px' : undefined,
    fontSize: '12.5px',
    fontWeight: 600,
  };

  const rootStyle: React.CSSProperties = isActive
    ? {
        ...baseRootStyle,
        background: 'oklch(from var(--bg-surface) l c h / 0.85)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        color: 'var(--violet-700)',
        boxShadow: 'none',
      }
    : {
        ...baseRootStyle,
        background: rootHover ? 'var(--bg-hover)' : 'transparent',
        color: 'var(--text-3)',
      };

  const closeStyle: React.CSSProperties = {
    background: 'transparent',
    color: 'inherit',
    border: 'none',
    borderRadius: 4,
    width: 16,
    height: 16,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: closeHover ? 1 : 0.6,
    transition: 'opacity 120ms ease',
    cursor: 'pointer',
  };

  return (
    <div
      className={cn(
        'relative flex items-center py-1.5',
        !showText && 'px-2 min-w-[36px] min-h-[36px] justify-center',
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
      <div
        className="flex items-center flex-1 min-w-0"
        style={{ gap: 6 }}
      >
        <Icon className="w-[13px] h-[13px] flex-shrink-0" />
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
          className={cn(!showText && 'hidden')}
          style={closeStyle}
          title={t('tabs.closeTab', { label: label.toLowerCase() })}
        >
          <X
            className="w-[11px] h-[11px]"
            strokeWidth={2.5}
          />
        </button>
      )}
      {isActive && (
        <span
          aria-hidden
          className="gradient-flow"
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: -7,
            height: 2.5,
            borderRadius: 2,
            background: accentGradient,
          }}
        />
      )}
    </div>
  );
}
