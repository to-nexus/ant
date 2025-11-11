import { useStore } from '@/domain/store';
import { textColors, cn } from '@/shared/utils/design-system';
import { Bar, BaseBarProps } from './Bar';
import { Columns, Rows, X } from 'lucide-react';
import { resetJobState } from '@/infrastructure/http/api';
import { useState } from 'react';
import { useUIActionPolicy } from '@/application/hooks/ui/useUIActionPolicy';

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
 * - Job ID (when agent job is running) with reset button
 * - Layout toggle buttons (horizontal/vertical split)
 * 
 * Similar to status bars in IDEs (VS Code, IntelliJ)
 */
export function MainPanelBar(props: BaseBarProps = {}) {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const selectedWorkType = useStore((state) => state.selectedWorkType);
  const currentJobId = useStore((state) => state.currentJobId);
  const currentMode = useStore((state) => state.currentMode);
  const splitLayout = useStore((state) => state.splitLayout);
  const toggleSplitLayout = useStore((state) => state.toggleSplitLayout);
  const reconnectSSE = useStore((state) => state.reconnectSSE);
  
  // ✅ UI Policy 시스템 사용
  const policy = useUIActionPolicy();
  
  const [isResetting, setIsResetting] = useState(false);
  
  // Handle job reset
  const handleResetJob = async () => {
    if (!selectedProject || !selectedFeature) {
      console.error('[MainPanelBar] Cannot reset: missing project/feature');
      return;
    }
    
    if (!confirm('Clear this job data? This will remove all tasks and job tracking from the session.')) {
      return;
    }
    
    try {
      setIsResetting(true);
      const jobType = (selectedWorkType as 'design' | 'code' | 'learn') || 'code';
      
      console.log('[MainPanelBar] Clearing job session data:', {
        project: selectedProject,
        feature: selectedFeature,
        job: jobType
      });
      
      // Clear session data on server
      await resetJobState(selectedProject, selectedFeature, jobType);
      
      // Reconnect SSE to fetch updated (empty) kanban data
      console.log('[MainPanelBar] Reconnecting SSE to fetch cleared data...');
      reconnectSSE('kanban');
      
      console.log('[MainPanelBar] ✅ Job session cleared successfully');
    } catch (error) {
      console.error('[MainPanelBar] Failed to clear job session:', error);
      alert('Failed to clear job session. See console for details.');
    } finally {
      setIsResetting(false);
    }
  };

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
          {/* Job ID with Reset Button */}
          {currentJobId && (
            <div className="flex items-center gap-2 border-l pl-3 border-gray-300 dark:border-gray-600">
              <span className={textColors.tertiary}>Job ID:</span>
              <span className={cn(textColors.secondary, 'font-mono text-xs')}>
                {currentJobId}
              </span>
              <button
                onClick={handleResetJob}
                disabled={!policy.canEditConfig || isResetting}
                className={cn(
                  'p-0.5 rounded transition-all',
                  'text-gray-500 dark:text-gray-400',
                  'hover:text-red-600 dark:hover:text-red-400',
                  'hover:bg-gray-200 dark:hover:bg-gray-700',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
                title={
                  !policy.canEditConfig 
                    ? policy.disabledReason || 'Cannot reset while task is running'
                    : 'Reset job tracking (start fresh)'
                }
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Layout Toggle Buttons */}
          <div className="flex items-center gap-1 border-l pl-3 border-gray-300 dark:border-gray-600">
            <button
              onClick={() => toggleSplitLayout('horizontal')}
              className={cn(
                'p-1.5 rounded transition-all',
                splitLayout === 'horizontal'
                  ? 'bg-emerald-600 dark:bg-emerald-500 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              )}
              title="Horizontal Split (Left/Right)"
            >
              <Columns className="w-4 h-4" />
            </button>
            <button
              onClick={() => toggleSplitLayout('vertical')}
              className={cn(
                'p-1.5 rounded transition-all',
                splitLayout === 'vertical'
                  ? 'bg-emerald-600 dark:bg-emerald-500 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              )}
              title="Vertical Split (Top/Bottom)"
            >
              <Rows className="w-4 h-4" />
            </button>
          </div>
        </div>
      ),
    className: props.className
  });
}

