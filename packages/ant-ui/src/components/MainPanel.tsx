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
 * - Content area (always split: 2 boards)
 * - Footer area (Terminal Bar)
 */
export function MainPanel({ children, headerBar, footer, className = '' }: MainPanelProps) {
  return (
    <main 
      className={`flex-1 bg-gray-50 dark:bg-gray-900 flex flex-col overflow-hidden transition-colors ${className}`}
      data-main-panel
    >
      {/* Header Bar (Status/Context + Layout Controls) */}
      {headerBar}
      
      {/* Content area (boards with independent scrolling) */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
      
      {/* Fixed footer area (Terminal Bar) */}
      {footer}
    </main>
  );
}

