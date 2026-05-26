import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/presentation/components/common/async';
import { KanbanColumnShell, COLUMN_TOKENS } from './KanbanColumnShell';

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
 * KanbanEstimatingSkeleton - Skeleton card layout for decompose/revise phases.
 * Shows 3-column Kanban layout with placeholder cards in "To Do" column,
 * indicating that tasks are about to be generated.
 *
 * This is shown BELOW the NodeActivityBanner when the current node
 * is decompose or revise (task generation nodes).
 *
 * Uses the shared `KanbanColumnShell` so the estimating preview and the
 * live kanban board share the exact same column chrome (accent bar, color
 * dot, label, counter pill).
 */
export function KanbanEstimatingSkeleton() {
  const { t } = useTranslation('kanban');
  return (
    <div className="grid grid-cols-3 gap-4 pt-4">
      {/* To Do column with skeleton cards */}
      <KanbanColumnShell
        accent={COLUMN_TOKENS.todo}
        label={t('columns.todo')}
        count="···"
        isHorizontalSplit={false}
      >
        {/* Staggered animation: 0ms, 200ms, 400ms delays */}
        <SkeletonCard delay={0} />
        <SkeletonCard delay={200} />
        <SkeletonCard delay={400} />
      </KanbanColumnShell>

      {/* In Progress column (empty) */}
      <KanbanColumnShell
        accent={COLUMN_TOKENS.inProgress}
        label={t('columns.inProgress')}
        count={0}
        isHorizontalSplit={false}
      >
        <div className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>
          {t('columns.waitingForTasks')}
        </div>
      </KanbanColumnShell>

      {/* Completed column (empty) */}
      <KanbanColumnShell
        accent={COLUMN_TOKENS.completed}
        label={t('columns.completed')}
        count={0}
        isHorizontalSplit={false}
      >
        <div className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>
          {t('columns.noCompletedTasks')}
        </div>
      </KanbanColumnShell>
    </div>
  );
}
