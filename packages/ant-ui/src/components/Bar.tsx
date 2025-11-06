import { ReactNode } from 'react';
import { borderColors, cn } from '@/lib/design-system';

interface BarProps {
  /**
   * Left side content (title, icon, buttons)
   */
  left: ReactNode;
  
  /**
   * Right side content (actions, badges, info)
   */
  right?: ReactNode;
  
  /**
   * Additional CSS classes
   */
  className?: string;
}

/**
 * Bar - Base component for all bar-style headers/footers
 * 
 * Provides consistent styling across:
 * - ExplorerBar (top of Explorer)
 * - MainPanelBar (top of MainPanel)
 * - TerminalBar (header section)
 * - Future bars
 * 
 * Design:
 * - Fixed height (h-10)
 * - Consistent padding (px-4)
 * - Consistent text size (text-sm)
 * - Consistent background/border
 * - Left/right content areas
 */
export function Bar({ left, right, className = '' }: BarProps) {
  return (
    <div 
      className={cn(
        // Layout
        'flex items-center justify-between shrink-0',
        // Spacing
        'h-10 px-4',
        // Background & Border
        'bg-gray-50 dark:bg-gray-900',
        'border-b',
        borderColors.default,
        // Additional classes
        className
      )}
    >
      {/* Left content */}
      <div className="flex items-center gap-3 text-sm">
        {left}
      </div>
      
      {/* Right content */}
      {right && (
        <div className="flex items-center gap-2 text-sm">
          {right}
        </div>
      )}
    </div>
  );
}

