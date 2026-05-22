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
      <div
        className="sticky top-0 z-10 shrink-0 px-4 py-2"
        style={{
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-1)',
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3
              className="text-sm font-semibold whitespace-nowrap"
              style={{ color: 'var(--text-1)' }}
            >
              {title}
            </h3>
            {titleActions && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {titleActions}
              </div>
            )}
          </div>
          {headerActions && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {headerActions}
            </div>
          )}
        </div>
      </div>
      
      {/* Content Area - board-level scroll in horizontal split, no scroll in vertical split */}
      <div
        className={`flex-1 overflow-hidden p-4 ${
          className.includes('kanban-board') && className.includes('horizontal')
            ? 'overflow-y-auto scrollbar-hide'
            : ''
        }`}
        style={{ background: 'var(--bg-surface)' }}
      >
        {children}
      </div>
    </div>
  );
}

