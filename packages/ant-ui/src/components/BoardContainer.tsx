import { ReactNode } from 'react';

interface BoardContainerProps {
  title: string;
  titleActions?: ReactNode;  // 타이틀 바로 옆에 위치할 요소
  headerActions?: ReactNode; // 우측 정렬될 요소
  children: ReactNode;
  className?: string;
}

/**
 * BoardContainer - Base container for board-style visualizations
 * 
 * Reusable container for Kanban Board, Workflow Visualization, etc.
 * Provides minimal, efficient layout with compact sticky header.
 * 
 * Features:
 * - Compact sticky header (matches gauge height)
 * - Optional header actions (gauges, badges, etc.)
 * - Scrollable content area
 * - No wrapper padding (efficient space usage)
 */
export function BoardContainer({ 
  title, 
  titleActions,
  headerActions, 
  children,
  className = ''
}: BoardContainerProps) {
  return (
    <div className={`flex flex-col h-full overflow-hidden ${className}`}>
      {/* Compact Sticky Header - pinned at top when scrolling */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0 px-4 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
              {title}
            </h3>
            {titleActions && (
              <div className="flex items-center gap-2">
                {titleActions}
              </div>
            )}
          </div>
          {headerActions && (
            <div className="flex items-center gap-2">
              {headerActions}
            </div>
          )}
        </div>
      </div>
      
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-800 p-4">
        {children}
      </div>
    </div>
  );
}

