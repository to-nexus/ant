import { useStore } from '@/lib/store';
import { textColors, borderColors, bgColors, cn } from '@/lib/design-system';

export function InfoFooter() {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const currentTaskId = useStore((state) => state.currentTaskId);
  const currentMode = useStore((state) => state.currentMode);
  const taskStartTime = useStore((state) => state.taskStartTime);

  return (
    <div className={cn(
      'border-t px-4 py-2 shrink-0',
      'bg-gray-50 dark:bg-gray-900',
      borderColors.default
    )}>
      <div className="flex items-center justify-between text-xs">
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
        {currentTaskId && (
          <div className="flex items-center gap-2">
            <span className={textColors.tertiary}>Task ID:</span>
            <span className={cn(textColors.secondary, 'font-mono text-xs')}>
              {currentTaskId}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
