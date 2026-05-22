import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/presentation/components/common/async';

/**
 * SkeletonCard - Placeholder card during decompose/revise.
 * The shell uses the `card` skeleton variant (shared primitive). The inner
 * rows use the `rect` variant with staggered `delayMs` for a subtle cascade.
 */
function SkeletonCard({ delay = 0 }: { delay?: number }) {
  return (
    <Skeleton variant="card" delayMs={delay}>
      <div className="flex items-start gap-2 mb-2">
        <Skeleton variant="rect" className="h-4 w-12" delayMs={delay} />
        <Skeleton variant="rect" className="flex-1 h-4" delayMs={delay + 60} />
        <Skeleton variant="rect" className="h-4 w-16" delayMs={delay + 120} />
      </div>
      <Skeleton variant="rect" className="h-3 w-3/4" delayMs={delay + 180} />
    </Skeleton>
  );
}

/**
 * Column header component
 */
function ColumnHeader({ icon, title, count }: { icon: string; title: string; count?: string | number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>
        {icon} {title}
      </h3>
      <div
        className="px-2 py-0.5 text-xs"
        style={{
          background: 'var(--bg-surface-2)',
          color: 'var(--text-2)',
          borderRadius: 'var(--r-pill)',
        }}
      >
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
        <div className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>
          {t('columns.waitingForTasks')}
        </div>
      </div>
      
      {/* Completed column (empty) */}
      <div className="space-y-3">
        <ColumnHeader icon="✅" title={t('columns.completed')} count={0} />
        <div className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>
          {t('columns.noCompletedTasks')}
        </div>
      </div>
    </div>
  );
}
