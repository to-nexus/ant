import { useStore } from '@/lib/store';
import { textColors, cn } from '@/lib/design-system';
import { Bar, BaseBarProps } from './Bar';
import { Columns, Rows } from 'lucide-react';

/**
 * MainPanelBar - Extends Bar
 * 
 * Status bar at the top of MainPanel.
 * Inherits base styling from Bar and adds specific functionality.
 * 
 * Displays current context information:
 * - Selected project
 * - Selected feature
 * - Current mode (generate/fix/etc)
 * - Job ID (when agent job is running)
 * - Layout toggle buttons (horizontal/vertical split)
 * 
 * Similar to status bars in IDEs (VS Code, IntelliJ)
 */
export function MainPanelBar(props: BaseBarProps = {}) {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const currentJobId = useStore((state) => state.currentJobId);
  const currentMode = useStore((state) => state.currentMode);
  const splitLayout = useStore((state) => state.splitLayout);
  const toggleSplitLayout = useStore((state) => state.toggleSplitLayout);

  // Render using base Bar
  return Bar.render({
    left: (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={textColors.tertiary}>Project:</span>
            <span className={cn(textColors.secondary, 'font-medium')}>
              {selectedProject || 'None'}
            </span>
          </div>
          {selectedFeature && (
            <div className="flex items-center gap-2">
              <span className={textColors.tertiary}>Feature:</span>
              <span className={cn(textColors.secondary, 'font-medium')}>
                {selectedFeature}
              </span>
            </div>
          )}
          {currentMode && (
            <div className="flex items-center gap-2">
              <span className={textColors.tertiary}>Mode:</span>
              <span className={cn(textColors.secondary, 'font-medium capitalize')}>
                {currentMode}
              </span>
            </div>
          )}
        </div>
      ),
    right: (
        <div className="flex items-center gap-3">
          {/* Layout Toggle Buttons */}
          <div className="flex items-center gap-1 border-l pl-3 border-gray-300 dark:border-gray-600">
            <button
              onClick={() => toggleSplitLayout('horizontal')}
              className={cn(
                'p-1.5 rounded transition-colors',
                splitLayout === 'horizontal'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              )}
              title="Horizontal Split (Left/Right)"
            >
              <Columns className="w-4 h-4" />
            </button>
            <button
              onClick={() => toggleSplitLayout('vertical')}
              className={cn(
                'p-1.5 rounded transition-colors',
                splitLayout === 'vertical'
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              )}
              title="Vertical Split (Top/Bottom)"
            >
              <Rows className="w-4 h-4" />
            </button>
          </div>

          {/* Job ID */}
          {currentJobId && (
            <div className="flex items-center gap-2 border-l pl-3 border-gray-300 dark:border-gray-600">
              <span className={textColors.tertiary}>Job ID:</span>
              <span className={cn(textColors.secondary, 'font-mono text-xs')}>
                {currentJobId}
              </span>
            </div>
          )}
        </div>
      ),
    className: props.className
  });
}

