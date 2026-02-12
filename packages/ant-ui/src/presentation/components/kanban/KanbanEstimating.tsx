import { useTranslation } from 'react-i18next';

/**
 * SkeletonCard - Placeholder card during decompose/revise
 * @param delay - Animation delay in milliseconds (for staggered effect)
 */
function SkeletonCard({ delay = 0 }: { delay?: number }) {
  return (
    <div 
      className="animate-pulse p-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start gap-2 mb-2">
        <div className="h-4 w-12 bg-gray-300 dark:bg-gray-600 rounded"></div>
        <div className="flex-1 h-4 bg-gray-300 dark:bg-gray-600 rounded"></div>
        <div className="h-4 w-16 bg-gray-300 dark:bg-gray-600 rounded"></div>
      </div>
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
    </div>
  );
}

/**
 * Column header component
 */
function ColumnHeader({ icon, title, count }: { icon: string; title: string; count?: string | number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h3 className="font-semibold text-sm text-gray-900 dark:text-white">
        {icon} {title}
      </h3>
      <div className="px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300">
        {count}
      </div>
    </div>
  );
}

/**
 * KanbanEstimatingSkeleton - Skeleton card layout for decompose/revise phases.
 * Shows 3-column Kanban layout with placeholder cards in "To Do" column,
 * indicating that tasks are about to be generated.
 * 
 * This is shown BELOW the NodeActivityBanner when the current node
 * is decompose or revise (task generation nodes).
 */
export function KanbanEstimatingSkeleton() {
  const { t } = useTranslation('kanban');
  return (
    <div className="grid grid-cols-3 gap-4 pt-4">
      {/* To Do column with skeleton cards */}
      <div className="space-y-3">
        <ColumnHeader icon="📝" title={t('columns.todo')} count="···" />
        <div className="space-y-2">
          {/* Staggered animation: 0ms, 200ms, 400ms delays */}
          <SkeletonCard delay={0} />
          <SkeletonCard delay={200} />
          <SkeletonCard delay={400} />
        </div>
      </div>
      
      {/* In Progress column (empty) */}
      <div className="space-y-3">
        <ColumnHeader icon="🔄" title={t('columns.inProgress')} count={0} />
        <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
          {t('columns.waitingForTasks')}
        </div>
      </div>
      
      {/* Completed column (empty) */}
      <div className="space-y-3">
        <ColumnHeader icon="✅" title={t('columns.completed')} count={0} />
        <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
          {t('columns.noCompletedTasks')}
        </div>
      </div>
    </div>
  );
}
