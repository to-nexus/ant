import { TaskTimer } from '../TaskTimer';
import { KanbanStatusBanner } from './KanbanStatusBanner';

/**
 * SkeletonCard - Placeholder card during decompose
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

interface KanbanEstimatingProps {
  jobTiming?: {
    startedAt?: string;
    completedAt?: string;
    pausedAt?: string;
    totalPausedDuration?: number;
  };
}

/**
 * KanbanEstimating - Estimating state display with full kanban layout
 * Uses StatusBanner + shows skeleton cards in To Do column while keeping layout intact
 */
export function KanbanEstimating({ jobTiming }: KanbanEstimatingProps) {
  
  return (
    <>
      {/* Compact banner with animated hourglass and timer */}
      <div className="mb-4 p-4 bg-purple-50 dark:bg-purple-950 border-2 border-purple-300 dark:border-purple-700 rounded-lg">
        <div className="flex items-start gap-4">
          {/* Animated hourglass icon */}
          <div className="text-2xl animate-spin">
            ⏳
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3">
              <div className="font-semibold text-base text-purple-900 dark:text-purple-200">
                Breaking down tasks...
              </div>
              {/* Elapsed time timer - using TaskTimer component (same as TaskCard) */}
              <div className="text-sm text-purple-700 dark:text-purple-300 whitespace-nowrap">
                ⏱️ <TaskTimer timing={jobTiming} isRunning={true} />
              </div>
            </div>
            <div className="text-sm text-purple-800 dark:text-purple-300 mt-2">
              Analyzing requirements and creating task queue
            </div>
          </div>
        </div>
      </div>
      
      {/* Full 3-column layout */}
      <div className="grid grid-cols-3 gap-4 pt-4">
        {/* To Do column with skeleton cards */}
        <div className="space-y-3">
          <ColumnHeader icon="📝" title="To Do" count="···" />
          <div className="space-y-2">
            {/* ✅ Staggered animation: 0ms, 200ms, 400ms delays */}
            <SkeletonCard delay={0} />
            <SkeletonCard delay={200} />
            <SkeletonCard delay={400} />
          </div>
        </div>
        
        {/* In Progress column (empty) */}
        <div className="space-y-3">
          <ColumnHeader icon="🔄" title="In Progress" count={0} />
          <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
            Waiting for tasks...
          </div>
        </div>
        
        {/* Completed column (empty) */}
        <div className="space-y-3">
          <ColumnHeader icon="✅" title="Completed" count={0} />
          <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
            No completed tasks yet
          </div>
        </div>
      </div>
    </>
  );
}

