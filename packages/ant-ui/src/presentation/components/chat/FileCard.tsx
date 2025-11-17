/**
 * FileCard - Cursor-style file operation card with real-time streaming
 * 
 * Displays file creation/editing/deletion with incremental content updates
 */

import { useEffect, useRef, useState } from 'react';
import { FilePlus, FileEdit, Trash2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { MessageContent } from '@/domain/models/chat';

interface FileCardProps {
  content: MessageContent;
  operation: 'create' | 'edit' | 'delete';
  isStreaming?: boolean;
}

export function FileCard({ content, operation }: FileCardProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const filePath = content.metadata?.filePath || 'Unknown file';
  const fileContent = content.content || '';  // ✅ Ensure string, never undefined
  const diffBefore = content.metadata?.diffBefore;
  const diffAfter = content.metadata?.diffAfter;
  
  // Determine streaming state based on content type
  const isCreating = content.type === 'file_creating';
  const isWriting = content.type === 'file_writing';
  const isEditing = content.type === 'file_editing';
  const isUpdating = content.type === 'file_updating';
  const isDeleting = content.type === 'file_deleting';
  const isActive = isCreating || isWriting || isEditing || isUpdating || isDeleting;
  const isCompleted = content.type === 'file_create' || content.type === 'file_edit' || content.type === 'file_delete';
  
  // ✅ Cursor/Copilot style: Default to expanded (show content), allow user to collapse
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  // ✅ Track if user manually scrolled away from bottom
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  
  // ✅ DEBUG: Log content updates
  useEffect(() => {
    console.log(`[FileCard] Content update - path: ${filePath}, type: ${content.type}, length: ${fileContent.length}, content preview: "${fileContent.substring(0, 50)}..."`);
  }, [fileContent, content.type, filePath]);
  
  // ✅ Reset user scrolling state when file operation completes
  useEffect(() => {
    if (isCompleted) {
      setIsUserScrolling(false);
    }
  }, [isCompleted]);
  
  // ✅ Show content when: has content OR is actively streaming
  const hasFileContent = fileContent && fileContent.length > 0;
  const hasDiffContent = diffBefore || diffAfter;
  const hasAnyContent = hasFileContent || hasDiffContent;
  
  // ✅ Streaming detection: simplified logic
  // Show content area when: (1) not collapsed AND has content, OR (2) is active
  const shouldShowContent = (isActive || !isCollapsed) && (hasAnyContent || isActive);
  
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
  
  // Calculate line stats
  const calculateLineStats = () => {
    if (operation === 'edit' && diffBefore && diffAfter) {
      const beforeLines = diffBefore.split('\n').length;
      const afterLines = diffAfter.split('\n').length;
      const added = afterLines;
      const removed = beforeLines;
      return { added, removed, total: null };
    } else if (fileContent) {
      const totalLines = fileContent.split('\n').length;
      return { 
        added: operation === 'create' ? totalLines : 0, 
        removed: operation === 'delete' ? totalLines : 0,
        total: totalLines 
      };
    }
    return { added: 0, removed: 0, total: 0 };
  };
  
  const lineStats = calculateLineStats();
  
  // Determine operation details (Copilot/Cursor style - subtle, modern)
  const operationConfig = {
    create: {
      icon: FilePlus,
      labelCompleted: 'Created',
      labelActive: isCreating ? 'Creating...' : 'Writing...',
      bgColor: 'bg-white dark:bg-gray-800/50',
      borderColor: 'border-gray-200 dark:border-gray-700',
      textColor: 'text-gray-700 dark:text-gray-300',
      iconColor: 'text-green-500 dark:text-green-400',
      headerBg: 'bg-gray-50/50 dark:bg-gray-800/30',
      hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
    },
    edit: {
      icon: FileEdit,
      labelCompleted: 'Modified',
      labelActive: isEditing ? 'Editing...' : 'Updating...',
      bgColor: 'bg-white dark:bg-gray-800/50',
      borderColor: 'border-gray-200 dark:border-gray-700',
      textColor: 'text-gray-700 dark:text-gray-300',
      iconColor: 'text-blue-500 dark:text-blue-400',
      headerBg: 'bg-gray-50/50 dark:bg-gray-800/30',
      hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
    },
    delete: {
      icon: Trash2,
      labelCompleted: 'Deleted',
      labelActive: 'Deleting...',
      bgColor: 'bg-white dark:bg-gray-800/50',
      borderColor: 'border-gray-200 dark:border-gray-700',
      textColor: 'text-gray-700 dark:text-gray-300',
      iconColor: 'text-red-500 dark:text-red-400',
      headerBg: 'bg-gray-50/50 dark:bg-gray-800/30',
      hoverBg: 'hover:bg-gray-100/50 dark:hover:bg-gray-800/50'
    }
  };
  
  const config = operationConfig[operation];
  const Icon = config.icon;
  
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
        className={`w-full ${config.headerBg} px-3 py-2.5 ${hasContentForButton && isCompleted ? config.hoverBg + ' cursor-pointer' : 'cursor-default'} transition-colors`}
      >
        <div className="flex items-center gap-2">
          {/* Operation Icon + Status */}
          {isActive ? (
            <Loader2 className={`w-4 h-4 ${config.iconColor} animate-spin flex-shrink-0`} />
          ) : (
            <Icon className={`w-4 h-4 ${config.iconColor} flex-shrink-0`} />
          )}
          
          {/* File Path */}
          <span className={`text-xs font-mono ${config.textColor} truncate flex-1 text-left`}>
            {filePath}
          </span>
          
          {/* Line Stats (Compact) */}
          {isCompleted && (
            <>
              {operation === 'edit' && (lineStats.added > 0 || lineStats.removed > 0) && (
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
              {operation === 'create' && lineStats.total != null && (
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
                <ChevronRight className={`w-4 h-4 ${config.textColor} opacity-60`} /> :
                <ChevronDown className={`w-4 h-4 ${config.textColor} opacity-60`} />
              }
            </div>
          )}
        </div>
      </button>
      
      {/* Content (auto-expand during streaming, collapsible when complete) */}
      {/* ✅ CRITICAL: Always render container when shouldShowContent is true (like ThinkingCard) */}
      {shouldShowContent && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {operation === 'edit' && (diffBefore || diffAfter) ? (
            // Diff view for edits (real-time streaming)
            <div ref={contentRef} className="max-h-[300px] overflow-y-auto scrollbar-thin" style={{ overflowAnchor: 'none' }} onScroll={handleScroll}>
              {diffBefore && (
                <div className="bg-red-50 dark:bg-red-900/10">
                  <pre className="px-4 py-2 text-xs font-mono text-red-800 dark:text-red-300 whitespace-pre-wrap break-words">
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
                  <pre className="px-4 py-2 text-xs font-mono text-green-800 dark:text-green-300 whitespace-pre-wrap break-words">
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
            // ✅ File content: Match ThinkingCard structure exactly
            // Container div with padding and max-height, pre inside with content
            <div 
              ref={contentRef}
              className="px-4 py-3 text-xs font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900/50 max-h-[300px] overflow-y-auto scrollbar-thin"
              style={{ overflowAnchor: 'none' }}
              onScroll={handleScroll}
            >
              <pre className="whitespace-pre-wrap break-words">
                {fileContent}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

