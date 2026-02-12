import { Columns, Rows } from 'lucide-react';
import { useStore } from '@/domain/store';
import { textColors, cn } from '@/shared/utils/design-system';
import { useAvailableModels } from '../hooks/useAvailableModels';
import { useCurrentTask } from '../hooks/useCurrentTask';
import { useModelName } from '../hooks/useModelName';
import { useTranslation } from 'react-i18next';

export function JobControls() {
  const { t } = useTranslation('nav');
  const currentJobId = useStore((state) => state.currentJobId);
  const splitLayout = useStore((state) => state.splitLayout);
  const toggleSplitLayout = useStore((state) => state.toggleSplitLayout);
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedJobType = useStore((state) => state.selectedJobType);
  const isRunning = useStore((state) => state.isRunning);
  
  const availableModels = useAvailableModels();
  const currentTask = useCurrentTask(currentJobId, isRunning);
  const modelName = useModelName(selectedProject, selectedJobType, availableModels, currentTask);

  return (
    <>
      {/* Model Badge - Only show when job is running */}
      {modelName && currentJobId && isRunning && (
        <div className="flex items-center gap-2">
          <span className={cn(textColors.secondary, 'font-medium')}>
            {modelName}
          </span>
        </div>
      )}
      
      {/* Split Layout Toggle */}
      <div className="flex items-center gap-1 border-l pl-3 border-gray-300 dark:border-gray-600">
        <button
          onClick={() => toggleSplitLayout('horizontal')}
          className={cn(
            'p-1.5 rounded transition-all',
            splitLayout === 'horizontal'
              ? 'bg-emerald-600 dark:bg-emerald-500 text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          )}
          title={t('splitLayout.horizontal')}
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
          title={t('splitLayout.vertical')}
        >
          <Rows className="w-4 h-4" />
        </button>
      </div>
    </>
  );
}
