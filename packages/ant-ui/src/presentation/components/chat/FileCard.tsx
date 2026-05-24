
/**
 * FileCard - Cursor-style file operation card with real-time streaming
 *
 * Aurora re-skin (T7): all surfaces / borders / text use var(--…) tokens
 * that auto-flip under [data-theme=dark]. Per-operation accents resolve
 * to --status-done-* / --violet-500 / --red-500 / --status-error-* /
 * --status-progress-* via inline style. No theme-prefix classes, no hex
 * literals, no Tailwind palette classes.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Ban } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import type { ChatStatusLine, PendingCardSnapshot } from '@ant/shared';
import { FileIcon } from '@/shared/utils/file-icons';
import { lineToContent } from './cards/lineToContent';
import { TurnCardShell } from './cards/TurnCardShell';

interface FileCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
  operation: 'create' | 'edit' | 'delete';
  isStreaming?: boolean;
}

// Token-driven operation accents.
// Base on status-*-bg tokens which auto-flip lightness (light 94% / dark 28%)
// per handoff tokens.css. Alpha 0.6 calibrates wash strength over --bg-surface
// so dark-theme diff lines remain readable instead of glaring near-white.
const RED_WASH = 'oklch(from var(--status-error-bg) l c h / 0.6)';
const GREEN_WASH = 'oklch(from var(--status-done-bg) l c h / 0.6)';

export const FileCard = memo(function FileCard({ line, pending, operation }: FileCardProps) {
  const content = lineToContent(line, pending);
  const { t } = useTranslation('chat');
  const contentRef = useRef<HTMLDivElement>(null);
  const headerTextRef = useRef<HTMLSpanElement>(null);
  const filePath = (content.metadata?.filePath as string | undefined) || t('card.unknownFile');
  const fileContent = content.content || '';
  const diffBefore = content.metadata?.diffBefore as string | undefined;
  const diffAfter = content.metadata?.diffAfter as string | undefined;

  const isCreating = content.type === 'file_creating';
  const isWriting = content.type === 'file_writing';
  const isEditing = content.type === 'file_editing';
  const isUpdating = content.type === 'file_updating';
  const isDeleting = content.type === 'file_deleting';
  const isActive = isCreating || isWriting || isEditing || isUpdating || isDeleting;
  const isFailed =
    content.type === 'file_create_failed' ||
    content.type === 'file_edit_failed' ||
    content.type === 'file_delete_failed';
  const isCompleted =
    content.type === 'file_create' ||
    content.type === 'file_edit' ||
    content.type === 'file_delete' ||
    isFailed;
  const isCancelled = isCompleted && !isFailed && !!content.metadata?.reason;

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
  const [isHeaderOverflowing, setIsHeaderOverflowing] = useState(false);
  const [isUserScrolling, setIsUserScrolling] = useState(false);

  useEffect(() => {
    if (isCompleted) {
      setIsUserScrolling(false);
    }
  }, [isCompleted]);

  useEffect(() => {
    if (isHeaderExpanded) return;
    if (typeof ResizeObserver === 'undefined') return;
    const element = headerTextRef.current;
    if (!element) return;

    const measureOverflow = () => {
      setIsHeaderOverflowing(element.scrollWidth > element.clientWidth + 1);
    };

    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  }, [filePath, isHeaderExpanded]);

  const hasFileContent = fileContent && fileContent.length > 0;
  const hasDiffContent = diffBefore || diffAfter;
  const hasErrorMessage = isFailed && content.metadata?.reason;
  const hasAnyContent = hasFileContent || hasDiffContent || hasErrorMessage;

  const shouldShowContent =
    !isCollapsed && (isActive || isFailed || (isCompleted && hasAnyContent));

  const prevScrollLengthRef = useRef(0);

  const isAtBottom = (element: HTMLDivElement) => {
    const threshold = 50;
    return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    if (isAtBottom(element)) {
      setIsUserScrolling(false);
    } else {
      setIsUserScrolling(true);
    }
  };

  useEffect(() => {
    if (isActive && contentRef.current && !isUserScrolling) {
      const currentLength = fileContent?.length || 0;
      if (currentLength > prevScrollLengthRef.current) {
        requestAnimationFrame(() => {
          if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
          }
        });
        prevScrollLengthRef.current = currentLength;
      }
    }
  }, [fileContent, isActive, isUserScrolling]);

  const calculateLineStats = () => {
    if (operation === 'edit' && diffBefore && diffAfter) {
      return { added: diffAfter.split('\n').length, removed: diffBefore.split('\n').length, total: null };
    } else if (operation === 'edit' && (content.metadata?.diffBeforeLines || content.metadata?.diffAfterLines)) {
      return { added: content.metadata.diffAfterLines ?? 0, removed: content.metadata.diffBeforeLines ?? 0, total: null };
    } else if (operation === 'create' && content.metadata?.diffBeforeLines) {
      const totalLines = fileContent
        ? fileContent.split('\n').length
        : (content.metadata.lineCount ?? 0);
      return {
        added: totalLines,
        removed: content.metadata.diffBeforeLines,
        total: totalLines,
      };
    } else if (fileContent) {
      const totalLines = fileContent.split('\n').length;
      return {
        added: operation === 'create' ? totalLines : 0,
        removed: operation === 'delete' ? totalLines : 0,
        total: totalLines,
      };
    } else if (content.metadata?.lineCount) {
      return {
        added: operation === 'create' ? content.metadata.lineCount : 0,
        removed: operation === 'delete' ? content.metadata.lineCount : 0,
        total: content.metadata.lineCount,
      };
    }
    return { added: 0, removed: 0, total: 0 };
  };

  const lineStats = calculateLineStats();
  const isOverwriteCreate =
    operation === 'create' && (content.metadata?.diffBeforeLines ?? 0) > 0;

  // Operation icon color (active spinner + completed icon hue).
  let iconColor: string;
  if (isFailed) {
    iconColor = 'var(--red-500)';
  } else if (operation === 'create') {
    iconColor = 'var(--status-done-fg)';
  } else if (operation === 'edit') {
    iconColor = 'var(--violet-500)';
  } else {
    iconColor = 'var(--red-500)';
  }

  // Label resolved per operation/state.
  let label: string;
  if (operation === 'create') {
    label = isFailed
      ? t('card.failed')
      : isActive
        ? (isCreating ? t('card.creating') : t('card.writing'))
        : isOverwriteCreate
          ? t('card.overwritten')
          : t('card.created');
  } else if (operation === 'edit') {
    label = isFailed
      ? t('card.failed')
      : isActive
        ? (isEditing ? t('card.editing') : t('card.updating'))
        : t('card.modified');
  } else {
    label = isFailed
      ? t('card.failed')
      : isActive
        ? t('card.deleting')
        : t('card.deleted');
  }
  void label;

  const canToggleContent = isCompleted && (hasAnyContent || isFailed);
  const canToggleHeader = isHeaderExpanded || isHeaderOverflowing;

  // Token-driven line-stat chips.
  const lineStatsItems = (() => {
    if (!isCompleted || isFailed || isCancelled) return [] as Array<{ text: string; bg: string; fg: string }>;

    if ((operation === 'edit' || isOverwriteCreate) && (lineStats.added > 0 || lineStats.removed > 0)) {
      return [
        { text: `+${lineStats.added}`, bg: 'var(--status-done-bg)', fg: 'var(--status-done-fg)' },
        { text: `-${lineStats.removed}`, bg: 'var(--status-error-bg)', fg: 'var(--status-error-fg)' },
      ];
    }

    if (operation === 'create' && !isOverwriteCreate && lineStats.total != null) {
      return [{ text: `+${lineStats.total}`, bg: 'var(--status-done-bg)', fg: 'var(--status-done-fg)' }];
    }

    if (operation === 'delete' && lineStats.total != null) {
      return [{ text: `-${lineStats.total}`, bg: 'var(--status-error-bg)', fg: 'var(--status-error-fg)' }];
    }

    return [] as Array<{ text: string; bg: string; fg: string }>;
  })();

  const handleHeaderToggle = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setIsHeaderExpanded(prev => !prev);
  };

  const handleHeaderToggleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleHeaderToggle(e);
    }
  };

  const headerFade = isFailed
    ? 'linear-gradient(to left, ' + RED_WASH + ', transparent)'
    : 'linear-gradient(to left, var(--bg-surface-2), transparent)';

  return (
    <TurnCardShell accent={isFailed ? 'error' : 'default'} hoverLift={!!canToggleContent}>
      {/* Header */}
      <button
        onClick={() => canToggleContent && setIsCollapsed(!isCollapsed)}
        disabled={!canToggleContent}
        className={`w-full px-2.5 py-1.5 transition-colors ${canToggleContent ? 'cursor-pointer' : 'cursor-default'}`}
        style={{ background: isFailed ? RED_WASH : 'var(--bg-surface-2)' }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {isActive ? (
            <span className="flex-shrink-0 inline-flex" style={{ color: iconColor }}>
              <Spinner size="md" tone="inherit" />
            </span>
          ) : (
            <FileIcon filePath={filePath} size={16} />
          )}

          <div className="flex-1 min-w-0">
            <div className="relative min-w-0">
              <span
                ref={headerTextRef}
                className={`block text-[11px] text-left min-w-0 ${
                  isHeaderExpanded ? 'whitespace-pre-wrap break-all' : 'truncate whitespace-nowrap'
                }`}
                style={{ color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}
                title={!isHeaderExpanded && isHeaderOverflowing ? filePath : undefined}
              >
                {filePath}
              </span>
              {!isHeaderExpanded && isHeaderOverflowing && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-8"
                  style={{ background: headerFade }}
                />
              )}
            </div>
          </div>

          {!isFailed && !isCancelled && lineStatsItems.length > 0 && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {lineStatsItems.map(item => (
                <span
                  key={item.text}
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                  style={{ background: item.bg, color: item.fg, fontFamily: 'var(--font-mono)' }}
                >
                  {item.text}
                </span>
              ))}
            </div>
          )}

          {isFailed ? (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Ban className="w-3 h-3" style={{ color: 'var(--red-500)' }} />
              <span className="text-[10px] font-medium" style={{ color: 'var(--red-500)' }}>
                {t('card.failed')}
              </span>
            </div>
          ) : isCancelled ? (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Ban className="w-3 h-3" style={{ color: 'var(--amber-500)' }} />
              <span className="text-[10px] font-medium" style={{ color: 'var(--status-progress-fg)' }}>
                {t('card.cancelled')}
              </span>
            </div>
          ) : null}

          {canToggleHeader && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleHeaderToggle}
              onKeyDown={handleHeaderToggleKeyDown}
              className="flex-shrink-0 p-0.5 rounded transition-colors cursor-pointer inline-flex items-center justify-center"
              style={{ color: 'var(--text-3)' }}
            >
              {isHeaderExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 opacity-60" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 opacity-60" />
              )}
            </span>
          )}

          {canToggleContent && (
            <div className="flex-shrink-0" style={{ color: 'var(--text-3)' }}>
              {isCollapsed
                ? <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                : <ChevronDown className="w-3.5 h-3.5 opacity-60" />}
            </div>
          )}
        </div>
      </button>

      {/* Content */}
      {shouldShowContent && (
        <div style={{ borderTop: '1px solid var(--border-1)' }}>
          {isFailed && content.metadata?.reason ? (
            <div
              className="px-3 py-2 text-[11px]"
              style={{ background: 'var(--status-error-bg)', color: 'var(--status-error-fg)' }}
            >
              <div className="font-semibold mb-1">{t('card.error')}</div>
              <div className="whitespace-pre-wrap break-words" style={{ fontFamily: 'var(--font-mono)' }}>
                {content.metadata.reason}
              </div>
            </div>
          ) : operation === 'edit' && (diffBefore || diffAfter) ? (
            <div
              ref={contentRef}
              className="max-h-[80px] overflow-y-auto scrollbar-thin"
              style={{ overflowAnchor: 'none', lineHeight: '1.5' }}
              onScroll={handleScroll}
            >
              {diffBefore && (
                <div style={{ background: RED_WASH }}>
                  <pre
                    className="px-3 py-1.5 text-[11px] whitespace-pre-wrap break-words"
                    style={{ lineHeight: '1.5', color: 'var(--red-500)', fontFamily: 'var(--font-mono)' }}
                  >
                    {diffBefore.split('\n').map((line, i) => (
                      <div key={i} className="flex">
                        <span className="mr-2" style={{ color: 'var(--red-500)' }}>-</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              )}
              {diffAfter && (
                <div style={{ background: GREEN_WASH }}>
                  <pre
                    className="px-3 py-1.5 text-[11px] whitespace-pre-wrap break-words"
                    style={{ lineHeight: '1.5', color: 'var(--status-done-fg)', fontFamily: 'var(--font-mono)' }}
                  >
                    {diffAfter.split('\n').map((line, i) => (
                      <div key={i} className="flex">
                        <span className="mr-2" style={{ color: 'var(--status-done-fg)' }}>+</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div
              ref={contentRef}
              className="px-3 py-2 text-[11px] max-h-[80px] overflow-y-auto scrollbar-thin"
              style={{
                overflowAnchor: 'none',
                lineHeight: '1.5',
                background: 'var(--bg-surface-2)',
                color: 'var(--text-1)',
                fontFamily: 'var(--font-mono)',
              }}
              onScroll={handleScroll}
            >
              <pre className="whitespace-pre-wrap break-words" style={{ lineHeight: '1.5' }}>
                {fileContent || ' '}
              </pre>
            </div>
          )}
        </div>
      )}
    </TurnCardShell>
  );
});
