import { ReactNode } from 'react';

interface BoardContainerProps {
  /**
   * Optional board title. When omitted (or empty), the title `<h3>` is not
   * rendered — used by views where the surrounding chrome (e.g. the
   * MainPanel view-mode toggle) already names the current board, so a
   * second heading would be redundant.
   */
  title?: string;
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
  // Kanban 및 workflow 보드 인스턴스는 outline-only frame 시각 언어를 따른다 —
  // 헤더와 컨텐츠 영역 배경을 투명 처리하여 페이지 전역 aurora mesh가
  // 컬럼/노드 사이로 비치게 한다. 그 외 사용처는 기존 surface 배경을
  // 그대로 유지한다.
  const isKanbanBoard = className.includes('kanban-board');
  const isWorkflowBoard = className.includes('workflow-board');
  return (
    <div className={`flex flex-col h-full overflow-hidden ${className}`}>
      {/* Compact Sticky Header - pinned at top when scrolling */}
      <div
        className="sticky top-0 z-10 shrink-0 px-4 py-2"
        style={{
          background: isKanbanBoard || isWorkflowBoard ? 'transparent' : 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-1)',
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {title ? (
              <h3
                className="text-sm font-semibold whitespace-nowrap"
                style={{ color: 'var(--text-1)' }}
              >
                {title}
              </h3>
            ) : null}
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
          isKanbanBoard && className.includes('horizontal')
            ? 'overflow-y-auto scrollbar-hide'
            : ''
        }`}
        style={{ background: isKanbanBoard || isWorkflowBoard ? 'transparent' : 'var(--bg-surface)' }}
      >
        {children}
      </div>
    </div>
  );
}

