import { ReactNode, ComponentType } from 'react';
import { borderColors, cn } from '@/lib/design-system';

/**
 * Base Bar Props
 * All Bar components must extend from this interface
 */
export interface BaseBarProps {
  /**
   * Additional CSS classes for customization
   */
  className?: string;
}

/**
 * Internal Bar render props (used by base implementation)
 */
interface BarRenderProps {
  left: ReactNode;
  right?: ReactNode;
  className?: string;
}

/**
 * Bar - Abstract Base Component
 * 
 * OOP-style base class for all bar-style headers/footers.
 * Provides consistent styling and layout structure.
 * 
 * Extended by:
 * - ExplorerBar (top of Explorer)
 * - MainPanelBar (top of MainPanel)  
 * - TerminalBar (header section)
 * 
 * Design System:
 * - Fixed height (h-10)
 * - Consistent padding (px-4)
 * - Consistent text size (text-sm)
 * - Consistent background/border
 * - Left/right content areas
 * 
 * Usage Pattern (OOP-style):
 * 1. Define a component that extends BaseBarProps
 * 2. Call renderBar() with left/right content
 * 3. Base styling is automatically applied
 */
export const Bar = {
  /**
   * Render base bar structure (protected method)
   * Only called by extending components
   */
  render({ left, right, className = '' }: BarRenderProps) {
    return (
      <div 
        className={cn(
          // Layout
          'flex items-center justify-between shrink-0',
          // Spacing
          'h-10 px-4',
          // Background & Border (더 짙은 회색)
          'bg-gray-200 dark:bg-[#0d1117]',
          'border-b border-gray-300 dark:border-[#30363d]',
          // Additional classes
          className
        )}
      >
        {/* Left content area */}
        <div className="flex items-center gap-3 text-sm">
          {left}
        </div>
        
        {/* Right content area */}
        {right && (
          <div className="flex items-center gap-2 text-sm">
            {right}
          </div>
        )}
      </div>
    );
  }
};

