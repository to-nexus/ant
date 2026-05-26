import { ReactNode } from 'react';

interface MainPanelProps {
  children: ReactNode;
  headerBar?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * MainPanel - Central content area of the application
 * 
 * The primary viewport where board-style visualizations are displayed:
 * - Kanban Board (task management)
 * - Workflow Board (agent visualization)
 * - Dashboard views (future)
 * 
 * Always displays split layout:
 * - Vertical (top/bottom) - default
 * - Horizontal (left/right)
 * - Independent scrolling per board
 * - Resizable divider (drag to adjust ratio)
 * 
 * Located between Explorer (left) and Config/File Editor panels (right)
 * 
 * Structure:
 * - Header Bar (status/context info + layout toggles)
 * - Content area (always split: 2 boards) - Flex-1, shrinks when terminal opens
 * - Footer area (Terminal Bar) - Flex layout, takes space from content area
 */
export function MainPanel({ children, headerBar, footer, className = '' }: MainPanelProps) {
  return (
    <main 
      className={`flex-1 flex flex-col overflow-hidden transition-colors ${className}`}
      style={{ background: 'var(--bg-base)' }}
      data-main-panel
    >
      {/* Header Bar (Status/Context + Layout Controls) */}
      {headerBar}
      
      {/* Content area (boards with independent scrolling) - Shrinks when terminal opens */}
      <div className="flex-1 overflow-hidden min-h-0">
        {children}
      </div>
      
      {/* Terminal Bar - Flex layout (pushes content area up when expanded) */}
      {footer}
    </main>
  );
}

