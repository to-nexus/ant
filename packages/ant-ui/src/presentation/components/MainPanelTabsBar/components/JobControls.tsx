import { Columns, Rows } from 'lucide-react';
import { useStore } from '@/domain/store';
import { textColors, cn } from '@/shared/utils/design-system';
import { useAvailableModels } from '../hooks/useAvailableModels';
import { useCurrentTask } from '../hooks/useCurrentTask';
import { useModelName } from '../hooks/useModelName';
import { useTranslation } from 'react-i18next';

const ACTIVE_BTN = 'bg-emerald-600 dark:bg-emerald-500 text-white shadow-sm';
const INACTIVE_BTN = 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700';

export function JobControls() {
  const { t } = useTranslation('nav');
  const currentJobId = useStore((state) => state.currentJobId);
  const splitLayout = useStore((state) => state.splitLayout);
  const toggleSplitLayout = useStore((state) => state.toggleSplitLayout);
  const taskViewMode = useStore((state) => state.taskViewMode);
  const setTaskViewMode = useStore((state) => state.setTaskViewMode);
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

      {/* Kanban arrangement toggle — only meaningful in kanban view.
          Icon ↔ value mapping is matched to the visual result of KanbanColumns:
            - Columns icon → 'vertical' state → grid-cols-3 (3 columns side by side)
            - Rows icon    → 'horizontal' state → flex-col (columns stacked as rows) */}
      {taskViewMode === 'kanban' && (
        <div className="flex items-center gap-1 border-l pl-3 border-gray-300 dark:border-gray-600">
          <button
            onClick={() => toggleSplitLayout('vertical')}
            className={cn(
              'p-1.5 rounded transition-all',
              splitLayout === 'vertical' ? ACTIVE_BTN : INACTIVE_BTN
            )}
            title={t('splitLayout.columns')}
          >
            <Columns className="w-4 h-4" />
          </button>
          <button
            onClick={() => toggleSplitLayout('horizontal')}
            className={cn(
              'p-1.5 rounded transition-all',
              splitLayout === 'horizontal' ? ACTIVE_BTN : INACTIVE_BTN
            )}
            title={t('splitLayout.rows')}
          >
            <Rows className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* View mode toggle — mutually exclusive Kanban / Workflow */}
      <div
        role="radiogroup"
        aria-label={t('viewMode.label')}
        className="flex items-center border-l pl-3 border-gray-300 dark:border-gray-600"
      >
        <button
          role="radio"
          aria-checked={taskViewMode === 'kanban'}
          onClick={() => setTaskViewMode('kanban')}
          className={cn(
            'px-2.5 py-1 text-xs font-medium rounded-l transition-all',
            taskViewMode === 'kanban' ? ACTIVE_BTN : INACTIVE_BTN
          )}
          title={t('viewMode.kanban')}
        >
          {t('viewMode.kanban')}
        </button>
        <button
          role="radio"
          aria-checked={taskViewMode === 'workflow'}
          onClick={() => setTaskViewMode('workflow')}
          className={cn(
            'px-2.5 py-1 text-xs font-medium rounded-r transition-all',
            taskViewMode === 'workflow' ? ACTIVE_BTN : INACTIVE_BTN
          )}
          title={t('viewMode.workflow')}
        >
          {t('viewMode.workflow')}
        </button>
      </div>
    </>
  );
}
