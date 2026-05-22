import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/presentation/components/aurora';
import { TaskTimer } from './TaskTimer';
import { ChevronDown, ChevronRight, Timer, Coins, Package, FileText, AlertCircle } from 'lucide-react';
import { UnifiedTask } from '@/domain/models/task';
import { useStore } from '@/domain/store';
import { cn } from '@/shared/utils/design-system';
import { formatTokenUsageCompact } from '@/shared/utils/tokenUtils';
import {
  TaskGlowPulseLayer,
  ShimmerSweepOverlay,
  SparkleOrbits,
  NewChip,
  GlowHalo,
} from './kanban/TaskCardEffects';

interface TaskCardProps {
  task: UnifiedTask;
  status: 'todo' | 'in-progress' | 'completed';
  index?: number;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  /** When true and status==='todo', show NEW chip + sparkle/glow halo. */
  newlyAdded?: boolean;
  /** When true and status==='completed', the completed-chip + sparkle/glow
   *  are rendered (the outer wrapper in KanbanColumns owns the halo + check
   *  chip; this flag is forwarded so TaskCard can opt into matching styles). */
  justCompleted?: boolean;
}

export function TaskCard({
  task,
  status,
  isExpanded = false,
  onToggleExpand,
  newlyAdded = false,
  justCompleted = false,
}: TaskCardProps) {
  const { t } = useTranslation('kanban');
  // Get actual running state from store
  const isTaskRunning = useStore((state) => state.isRunning);
  
  const defaultExpanded = isExpanded;
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  
  const expanded = onToggleExpand !== undefined ? isExpanded : localExpanded;
  const toggleExpand = onToggleExpand || (() => setLocalExpanded(!localExpanded));

  const hasDescription = task.description && task.description.trim() !== '';
  // Show expand button for all statuses if there's description (not just in-progress)
  const showExpandButton = hasDescription;
  
  // Debug: Check task data (disabled to reduce log noise)
  // if (status === 'todo' || status === 'in-progress') {
  //   console.log(`[TaskCard] ${status}:`, {
  //     name: task.name,
  //     priority: task.priority,
  //     hasPriority: task.priority !== undefined,
  //     hasDescription,
  //     type: task.type
  //   });
  // }
  
  // ✅ Determine display type from task type
  const displayType = task.type;
  
  // Type badge styling — Aurora-tokenized chips (background + text via inline style).
  const typeBadgeMap: Record<string, { bg: string; label: string }> = {
    feature:        { bg: 'var(--violet-500)', label: 'FEAT' },
    bug:            { bg: 'var(--red-500)',    label: 'BUG' },
    doc:            { bg: 'var(--teal-500)',   label: 'DOC' },
    documentation:  { bg: 'var(--teal-500)',   label: 'DOC' },
    task:           { bg: 'var(--violet-500)', label: 'TASK' },
    implementation: { bg: 'var(--violet-500)', label: 'IMPL' },
    testing:        { bg: 'var(--orange-500)', label: 'TEST' },
    review:         { bg: 'var(--pink-500)',   label: 'REVIEW' },
    deployment:     { bg: 'var(--teal-500)',   label: 'DEPLOY' },
    bugfix:         { bg: 'var(--orange-500)', label: 'FIX' },
    refactor:       { bg: 'var(--violet-500)', label: 'REFACTOR' },
  };

  const safeType = displayType || 'task';
  const typeBadge = typeBadgeMap[safeType.toLowerCase()] || {
    bg: 'var(--text-3)',
    label: safeType.toUpperCase(),
  };
  
  /** Long paths / URLs: break inside long tokens when needed (stricter than word-only wrap). */
  const pathFriendlyText = 'min-w-0 max-w-full [overflow-wrap:anywhere]';

  // Aurora root style — single source of truth for card surface.
  const rootStyle: React.CSSProperties =
    status === 'in-progress'
      ? {
          background: 'var(--bg-surface)',
          border: '2px solid transparent',
          borderRadius: 'var(--r-md)',
          color: 'var(--text-1)',
          boxShadow:
            '0 0 0 2px var(--violet-500), 0 0 24px var(--shadow-glow-aurora)',
        }
      : {
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-1)',
          borderRadius: 'var(--r-md)',
          color: 'var(--text-1)',
        };

  const showTodoNewState = status === 'todo' && newlyAdded;
  const showCompletedNewState = status === 'completed' && justCompleted;

  return (
    <div
      className={cn(
        'p-3 transition-colors relative min-w-0 w-full',
      )}
      style={rootStyle}
    >
      {/* In-progress aurora effects (replaces wave-slide-continuous) */}
      {status === 'in-progress' && (
        <>
          <TaskGlowPulseLayer />
          <ShimmerSweepOverlay variant="in-progress" />
        </>
      )}

      {/* Newly-added todo: NEW state overlays */}
      {showTodoNewState && (
        <>
          <GlowHalo />
          <SparkleOrbits />
        </>
      )}

      {/* Just-completed: sparkle/glow overlays (TaskCard-local — the
          KanbanColumns wrapper also renders matching outer overlays). */}
      {showCompletedNewState && (
        <>
          <GlowHalo />
          <SparkleOrbits />
        </>
      )}

      <div className="flex min-w-0 items-start gap-2 relative z-10">
        {showExpandButton && (
          <button
            className="mt-0.5 transition-opacity opacity-70 hover:opacity-100"
            style={{ color: 'var(--text-3)' }}
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand();
            }}
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        )}
        
        <div className="flex-1 min-w-0">
          {/* Task Name - Full Width (Clickable to toggle) */}
          <div
            className={cn(
              'mb-2 min-w-0',
              showExpandButton ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''
            )}
            onClick={showExpandButton ? toggleExpand : undefined}
          >
            <span
              className={cn('block text-sm font-medium', pathFriendlyText)}
              style={{ color: 'var(--text-1)' }}
            >
              {task.name}
            </span>
          </div>

          {/* Badges + Timer Row - Wrap automatically (Clickable to toggle) */}
          <div
            className={cn(
              'flex min-w-0 flex-wrap items-center gap-2',
              showExpandButton ? 'cursor-pointer' : ''
            )}
            onClick={showExpandButton ? toggleExpand : undefined}
          >
            {/* NEW chip — newly-added todos */}
            {showTodoNewState && <NewChip />}

            {/* Priority Badge - Only for to-do */}
            {status === 'todo' && task.priority !== undefined && (
              <Badge
                tone="info"
                className="flex-shrink-0"
                style={{
                  background: 'var(--status-todo-bg)',
                  color: 'var(--status-todo-fg)',
                  borderColor: 'var(--border-1)',
                }}
              >
                {`P${task.priority}`}
              </Badge>
            )}

            {/* Failed Badge - Resumable failure (call-budget exhausted etc.).
                Takes precedence over the generic "Paused" badge because failed
                tasks ARE interrupted at the job level but carry an actionable
                failure reason. Tooltip surfaces _failureReason verbatim. */}
            {status === 'todo' && task._failed && (
              <Badge
                tone="error"
                title={task._failureReason}
                className="flex items-center gap-1 flex-shrink-0"
                style={{
                  background: 'var(--status-error-bg)',
                  color: 'var(--status-error-fg)',
                  borderColor: 'var(--border-1)',
                }}
              >
                <AlertCircle className="w-3 h-3" />
                <span className="font-semibold text-xs">{t('task.failed')}</span>
              </Badge>
            )}

            {/* Interrupted Badge - Only for to-do tasks that were interrupted
                but NOT failed (user-stopped / recursion-limit pauses). */}
            {status === 'todo' && task.interrupted && !task._failed && (
              <Badge
                tone="warning"
                className="flex items-center gap-1 flex-shrink-0"
                style={{
                  background: 'var(--status-progress-bg)',
                  color: 'var(--status-progress-fg)',
                  borderColor: 'var(--border-1)',
                }}
              >
                <Timer className="w-3 h-3" />
                <span className="font-semibold text-xs">{t('task.paused')}</span>
              </Badge>
            )}

            {/* Type Badge */}
            <Badge
              className="text-xs flex-shrink-0"
              style={{
                background: typeBadge.bg,
                color: 'var(--text-on-brand)',
                borderColor: 'transparent',
              }}
            >
              {typeBadge.label}
            </Badge>

            {/* Package Scope */}
            {task.packages && task.packages.length > 0 && (
              <span
                className="flex min-w-0 max-w-full flex-wrap items-start gap-1 text-xs"
                style={{ color: 'var(--text-2)' }}
              >
                <Package className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span className={pathFriendlyText}>{task.packages.join(', ')}</span>
              </span>
            )}

            {/* Source Files (design job) */}
            {!task.packages && task.sourceFiles && task.sourceFiles.length > 0 && (
              <span
                className="flex min-w-0 max-w-full flex-wrap items-start gap-1 text-xs"
                style={{ color: 'var(--text-2)' }}
              >
                <FileText className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span className={pathFriendlyText}>{task.sourceFiles.join(', ')}</span>
              </span>
            )}

            {/* Timer - Show for in-progress and completed */}
            {status === 'in-progress' && (
              <span
                className="font-medium flex items-center gap-1 text-xs flex-shrink-0"
                style={{ color: 'var(--text-2)' }}
              >
                <Timer className="w-3.5 h-3.5" />
                <TaskTimer timing={task.timing} isRunning={isTaskRunning} />
              </span>
            )}
            {status === 'completed' && task.timing && task.timing.elapsedTime !== undefined && (
              <span
                className="flex items-center gap-1 text-xs flex-shrink-0"
                style={{ color: 'var(--text-2)' }}
              >
                <Timer className="w-3.5 h-3.5" />
                <TaskTimer timing={task.timing} />
              </span>
            )}

            {/* Token Usage - Show for in-progress (real-time) and completed tasks */}
            {(status === 'in-progress' || status === 'completed') && task.tokenUsage && (
              <span
                className="flex items-center gap-1 text-xs flex-shrink-0"
                style={{ color: 'var(--text-2)' }}
              >
                <Coins className="w-3.5 h-3.5" />
                {formatTokenUsageCompact(task.tokenUsage)}
              </span>
            )}
          </div>

          {/* Expanded content - NOT clickable (allows text selection) */}
          {expanded && hasDescription && (
            <div
              className={cn(
                'mt-2 min-w-0 p-2 text-xs select-text relative z-20',
                'whitespace-pre-wrap [overflow-wrap:anywhere]',
              )}
              style={{
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-1)',
                borderRadius: 'var(--r-sm)',
                color: 'var(--text-2)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {task.description}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
