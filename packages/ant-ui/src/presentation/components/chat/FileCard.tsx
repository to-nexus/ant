/**
 * FileCard - Cursor-style file operation card with real-time streaming
 * 
 * Displays file creation/editing/deletion with incremental content updates
 */

import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Ban } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import type { ChatStatusLine, PendingCardSnapshot } from '@ant/shared';
import { FileIcon } from '@/shared/utils/file-icons';
import { lineToContent } from './cards/lineToContent';

interface FileCardProps {
  line: ChatStatusLine;
  pending?: PendingCardSnapshot;
  operation: 'create' | 'edit' | 'delete';
  isStreaming?: boolean;
}

export const FileCard = memo(function FileCard({ line, pending, operation }: FileCardProps) {
  const content = lineToContent(line, pending);
  const { t } = useTranslation('chat');
  const contentRef = useRef<HTMLDivElement>(null);
  const filePath = (content.metadata?.filePath as string | undefined) || t('card.unknownFile');
  const fileContent = content.content || '';  // ✅ Ensure string, never undefined
  const diffBefore = content.metadata?.diffBefore as string | undefined;
  const diffAfter = content.metadata?.diffAfter as string | undefined;
  
  // Determine streaming state based on content type
  const isCreating = content.type === 'file_creating';
  const isWriting = content.type === 'file_writing';
  const isEditing = content.type === 'file_editing';
  const isUpdating = content.type === 'file_updating';
  const isDeleting = content.type === 'file_deleting';
  const isActive = isCreating || isWriting || isEditing || isUpdating || isDeleting;
  const isFailed = content.type === 'file_create_failed' || content.type === 'file_edit_failed' || content.type === 'file_delete_failed';
  const isCompleted = content.type === 'file_create' || content.type === 'file_edit' || content.type === 'file_delete' || isFailed;
  
  // ✅ Cursor/Copilot style: Default to expanded (show content), allow user to collapse
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  // ✅ Track if user manually scrolled away from bottom
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  
  
  // ✅ Reset user scrolling state when file operation completes
  useEffect(() => {
    if (isCompleted) {
      setIsUserScrolling(false);
    }
  }, [isCompleted]);
  
  // ✅ Show content when: has content OR is actively streaming (even with empty content)
  const hasFileContent = fileContent && fileContent.length > 0;
  const hasDiffContent = diffBefore || diffAfter;
  const hasErrorMessage = isFailed && content.metadata?.reason;
  const hasAnyContent = hasFileContent || hasDiffContent || hasErrorMessage;
  
  // ✅ CRITICAL: Show content during streaming (isActive) for real-time preview
  // - For streaming: Show even if empty (file_creating, file_writing, etc.)
  // - For completed: Show only if has content
  // - For failed: Always show (to display error message)
  const shouldShowContent = !isCollapsed && (
    (isActive) ||  // Always show during streaming (even empty)
    (isFailed) ||  // Always show failed (to display error)
    (isCompleted && hasAnyContent)  // Show completed only if has content
  );
  
  // ✅ CRITICAL: Use ref to track previous content length for auto-scroll
  const prevScrollLengthRef = useRef(0);
  
  // ✅ Check if user is at bottom of scroll area
  const isAtBottom = (element: HTMLDivElement) => {
    const threshold = 50; // 50px threshold for "near bottom"
    return element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
  };
  
  // ✅ Handle user manual scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const element = e.currentTarget;
    
    if (isAtBottom(element)) {
      // User scrolled to bottom → re-enable auto-scroll
      setIsUserScrolling(false);
    } else {
      // User scrolled away from bottom → disable auto-scroll
      setIsUserScrolling(true);
    }
  };
  
  // ✅ Auto-scroll to bottom during streaming (only if user hasn't manually scrolled)
  useEffect(() => {
    if (isActive && contentRef.current && !isUserScrolling) {
      const currentLength = fileContent?.length || 0;
      
      // Only scroll if content actually grew (prevent infinite loops)
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
  
  // Calculate line stats (supports both full content and lightweight metadata from chat.jsonl)
  const calculateLineStats = () => {
    if (operation === 'edit' && diffBefore && diffAfter) {
      return { added: diffAfter.split('\n').length, removed: diffBefore.split('\n').length, total: null };
    } else if (operation === 'edit' && (content.metadata?.diffBeforeLines || content.metadata?.diffAfterLines)) {
      return { added: content.metadata.diffAfterLines ?? 0, removed: content.metadata.diffBeforeLines ?? 0, total: null };
    } else if (operation === 'create' && content.metadata?.diffBeforeLines) {
      // Overwrite-create: `<file>` tag replaced an existing file. Render
      // `+Y -X` using the new content length for `added` and the pre-write
      // line count (captured by FileRenderer) for `removed`.
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
        total: totalLines 
      };
    } else if (content.metadata?.lineCount) {
      return { 
        added: operation === 'create' ? content.metadata.lineCount : 0, 
        removed: operation === 'delete' ? content.metadata.lineCount : 0,
        total: content.metadata.lineCount 
      };
    }
    return { added: 0, removed: 0, total: 0 };
  };
  
  const lineStats = calculateLineStats();
  // Overwrite-create case is an "edit" in spirit — show `+added -removed`
  // with the edit label even though the underlying event type is `file_create`.
  const isOverwriteCreate =
    operation === 'create' && (content.metadata?.diffBeforeLines ?? 0) > 0;
  
  // Determine operation details (Copilot/Cursor style - subtle, modern)
  const operationConfig = {
    create: {
      // Overwrite-create (`<file>` tag on an existing file) labels as
      // "Overwrote" — semantically closer to an edit than a fresh create.
      labelCompleted: isFailed
        ? t('card.failed')
        : isOverwriteCreate
          ? t('card.overwritten')
          : t('card.created'),
      labelActive: isCreating ? t('card.creating') : t('card.writing'),
      bgColor: isFailed ? 'bg-red-50/50 dark:bg-red-900/10' : 'bg-white dark:bg-gray-800/50',
      borderColor: isFailed ? 'border-red-300 dark:border-red-800' : 'border-gray-200 dark:border-gray-700',
      textColor: isFailed ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300',
      iconColor: isFailed ? 'text-red-600 dark:text-red-400' : 'text-green-500 dark:text-green-400',
      headerBg: isFailed ? 'bg-red-100/50 dark:bg-red-900/20' : 'bg-gray-50/50 dark:bg-gray-800/30',
      hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
    },
    edit: {
      labelCompleted: isFailed ? t('card.failed') : t('card.modified'),
      labelActive: isEditing ? t('card.editing') : t('card.updating'),
      bgColor: isFailed ? 'bg-red-50/50 dark:bg-red-900/10' : 'bg-white dark:bg-gray-800/50',
      borderColor: isFailed ? 'border-red-300 dark:border-red-800' : 'border-gray-200 dark:border-gray-700',
      textColor: isFailed ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300',
      iconColor: isFailed ? 'text-red-600 dark:text-red-400' : 'text-blue-500 dark:text-blue-400',
      headerBg: isFailed ? 'bg-red-100/50 dark:bg-red-900/20' : 'bg-gray-50/50 dark:bg-gray-800/30',
      hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
    },
    delete: {
      labelCompleted: isFailed ? t('card.failed') : t('card.deleted'),
      labelActive: t('card.deleting'),
      bgColor: isFailed ? 'bg-red-50/50 dark:bg-red-900/10' : 'bg-white dark:bg-gray-800/50',
      borderColor: isFailed ? 'border-red-300 dark:border-red-800' : 'border-gray-200 dark:border-gray-700',
      textColor: isFailed ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300',
      iconColor: isFailed ? 'text-red-600 dark:text-red-400' : 'text-red-500 dark:text-red-400',
      headerBg: isFailed ? 'bg-red-100/50 dark:bg-red-900/20' : 'bg-gray-50/50 dark:bg-gray-800/30',
      hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
    }
  };
  
  const config = operationConfig[operation];
  
  // Check if there's content to show for collapse button
  const hasContentForButton = (operation === 'create' && fileContent) || 
                               (operation === 'edit' && (diffBefore || diffAfter)) ||
                               (operation === 'delete' && fileContent);
  
  return (
    <div className={`border ${config.borderColor} rounded-lg overflow-hidden ${config.bgColor}`}>
      {/* Header - Copilot/Cursor Style (Single Row, Compact) */}
      <button 
        onClick={() => hasContentForButton && isCompleted && setIsCollapsed(!isCollapsed)}
        disabled={!hasContentForButton || !isCompleted}
        className={`w-full ${config.headerBg} px-2.5 py-1.5 ${hasContentForButton && isCompleted ? config.hoverBg + ' cursor-pointer' : 'cursor-default'} transition-colors`}
      >
        <div className="flex items-center gap-1.5">
          {/* File Icon - Shows loading spinner when active, file type icon when complete */}
          {isActive ? (
            <Spinner size="md" tone="inherit" className={`flex-shrink-0 ${config.iconColor}`} />
          ) : (
            <FileIcon filePath={filePath} size={16} />
          )}
          
          {/* File Path */}
          <span className={`text-[11px] font-mono ${config.textColor} truncate flex-1 text-left`}>
            {filePath}
          </span>
          
          {/* Failed/Cancelled Indicator or Line Stats */}
          {isFailed ? (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Ban className="w-3 h-3 text-red-500 dark:text-red-400" />
              <span className="text-[10px] text-red-600 dark:text-red-400 font-medium">
                {t('card.failed')}
              </span>
            </div>
          ) : isCompleted && content.metadata?.reason ? (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Ban className="w-3 h-3 text-orange-500 dark:text-orange-400" />
              <span className="text-[10px] text-orange-600 dark:text-orange-400 font-medium">
                {t('card.cancelled')}
              </span>
            </div>
          ) : isCompleted && (
            <>
              {(operation === 'edit' || isOverwriteCreate) && (lineStats.added > 0 || lineStats.removed > 0) && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {lineStats.added >= 0 && (
                    <span className="text-[10px] text-green-600 dark:text-green-400 font-mono font-medium">
                      +{lineStats.added}
                    </span>
                  )}
                  {lineStats.removed >= 0 && (
                    <span className="text-[10px] text-red-600 dark:text-red-400 font-mono font-medium">
                      -{lineStats.removed}
                    </span>
                  )}
                </div>
              )}
              {operation === 'create' && !isOverwriteCreate && lineStats.total != null && (
                <span className="text-[10px] text-green-600 dark:text-green-400 font-mono font-medium flex-shrink-0">
                  +{lineStats.total}
                </span>
              )}
              {operation === 'delete' && lineStats.total != null && (
                <span className="text-[10px] text-red-600 dark:text-red-400 font-mono font-medium flex-shrink-0">
                  -{lineStats.total}
                </span>
              )}
            </>
          )}
          
          {/* Expand/Collapse Icon */}
          {isCompleted && hasContentForButton && (
            <div className="flex-shrink-0">
              {isCollapsed ? 
                <ChevronRight className={`w-3.5 h-3.5 ${config.textColor} opacity-60`} /> :
                <ChevronDown className={`w-3.5 h-3.5 ${config.textColor} opacity-60`} />
              }
            </div>
          )}
        </div>
      </button>
      
      {/* Content (auto-expand during streaming, collapsible when complete) */}
      {/* ✅ CRITICAL: Always render container when shouldShowContent is true (like ThinkingCard) */}
      {shouldShowContent && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {isFailed && content.metadata?.reason ? (
            // Error message for failed operations
            <div className="px-3 py-2 text-[11px] bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200">
              <div className="font-semibold mb-1">{t('card.error')}</div>
              <div className="whitespace-pre-wrap break-words font-mono">
                {content.metadata.reason}
              </div>
            </div>
          ) : operation === 'edit' && (diffBefore || diffAfter) ? (
            // Diff view for edits - compact body (about 4 lines visible)
            <div ref={contentRef} className="max-h-[80px] overflow-y-auto scrollbar-thin" style={{ overflowAnchor: 'none', lineHeight: '1.5' }} onScroll={handleScroll}>
              {diffBefore && (
                <div className="bg-red-50 dark:bg-red-900/10">
                  <pre className="px-3 py-1.5 text-[11px] font-mono text-red-800 dark:text-red-300 whitespace-pre-wrap break-words" style={{ lineHeight: '1.5' }}>
                    {diffBefore.split('\n').map((line, i) => (
                      <div key={i} className="flex">
                        <span className="text-red-600 dark:text-red-400 mr-2">-</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              )}
              {diffAfter && (
                <div className="bg-green-50 dark:bg-green-900/10">
                  <pre className="px-3 py-1.5 text-[11px] font-mono text-green-800 dark:text-green-300 whitespace-pre-wrap break-words" style={{ lineHeight: '1.5' }}>
                    {diffAfter.split('\n').map((line, i) => (
                      <div key={i} className="flex">
                        <span className="text-green-600 dark:text-green-400 mr-2">+</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            // File content with compact height and typography
            <div 
              ref={contentRef}
              className="px-3 py-2 text-[11px] font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/50 max-h-[80px] overflow-y-auto scrollbar-thin"
              style={{ overflowAnchor: 'none', lineHeight: '1.5' }}
              onScroll={handleScroll}
            >
              <pre className="whitespace-pre-wrap break-words" style={{ lineHeight: '1.5' }}>
                {fileContent || ' '}
                {/* ⬆️ Empty space to show container even when empty (during streaming) */}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

