import { Badge } from '@/presentation/components/common/badge';
import { TaskCard } from '../TaskCard';
import { motion, LayoutGroup } from 'framer-motion';
import { UnifiedTask } from '@/domain/models/task';
import { WorkflowRealtimeState } from '@/domain/models/workflow';
import type { ActiveWorkerNode } from '@/domain/models/workflow';
import { useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { PopAppear, useAutoScrollOnGrowth } from '../common/motion';

/**
 * Inline node status shown directly below each in-progress task card.
 * Displays which workflow node a task is currently in.
 */
function InlineNodeStatus({ node }: { node: ActiveWorkerNode | undefined }) {
  const isRunning = useStore(state => state.isRunning);
  const isStopping = useStore(state => state.isStopping);
  
  if (!node || !isRunning || isStopping) return null;
  
  const formatNodeName = (nodeId: string): string =>
    nodeId.split(/(?=[A-Z])/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  return (
    <div className="flex min-w-0 items-center gap-1.5 px-3 py-1 bg-gray-50/50 dark:bg-gray-800/30 rounded-b-lg border-x border-b border-gray-200/60 dark:border-gray-700/40">
      <div className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
      </div>
      <span className="min-w-0 text-[10px] font-medium text-blue-600 dark:text-blue-400 [overflow-wrap:anywhere]">
        {formatNodeName(node.nodeId)}
      </span>
    </div>
  );
}

interface KanbanColumnsProps {
  todoTasks: UnifiedTask[];
  inProgressTasks: UnifiedTask[];
  completedTasks: UnifiedTask[];
  newlyAddedTodoIds: Set<string>;
  newlyCompletedIds: Set<string>;
  newlyInProgressId: string | null;
  splitLayout: 'horizontal' | 'vertical';
  workflowDisplayedState: WorkflowRealtimeState | null;
  onInProgressAnimationComplete: () => void;
}

/**
 * KanbanColumns - Three column layout (To Do, In Progress, Completed)
 * Handles task card rendering with animations
 * 
 * Layout:
 * - Horizontal split (left/right): Columns arranged vertically (flex-col)
 * - Vertical split (top/bottom): Columns arranged horizontally (grid-cols-3)
 * - Each column has fixed header + scrollable content
 */
export function KanbanColumns({
  todoTasks,
  inProgressTasks,
  completedTasks,
  newlyAddedTodoIds,
  newlyCompletedIds,
  newlyInProgressId,
  splitLayout,
  workflowDisplayedState,
  onInProgressAnimationComplete
}: KanbanColumnsProps) {
  const { t } = useTranslation('kanban');
  const isHorizontalSplit = splitLayout === 'horizontal';
  
  // ✅ Sort todo tasks by priority before rendering
  const sortedTodoTasks = useMemo(() => {
    return [...todoTasks].sort((a, b) => {
      const priorityA = typeof a.priority === 'number' ? a.priority : 999;
      const priorityB = typeof b.priority === 'number' ? b.priority : 999;
      return priorityA - priorityB;
    });
  }, [todoTasks]);

  // Follow-tail: when the todo column grows (decompose streaming a new
  // <task>), smooth-scroll the nearest scrollable ancestor to its bottom.
  // findScrollParent in the hook handles both layouts (per-column scroll
  // vs. board-level scroll under horizontal split).
  const todoListRef = useRef<HTMLDivElement>(null);
  useAutoScrollOnGrowth(todoListRef, sortedTodoTasks.length);

  // ✅ Auto-clear in-progress animation flag
  const inProgressTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (newlyInProgressId) {
      if (inProgressTimerRef.current) {
        clearTimeout(inProgressTimerRef.current);
      }
      inProgressTimerRef.current = setTimeout(() => {
        onInProgressAnimationComplete();
        inProgressTimerRef.current = null;
      }, 800) as unknown as number;
    }
    
    return () => {
      if (inProgressTimerRef.current) {
        clearTimeout(inProgressTimerRef.current);
        inProgressTimerRef.current = null;
      }
    };
  }, [newlyInProgressId, onInProgressAnimationComplete]);

  // Newly-completed shine cleanup is owned by `useNewlyAdded` in the parent
  // (autoClearMs: 1200); no per-id timers live in this component anymore.
  
  return (
    <LayoutGroup>
      <div className={isHorizontalSplit ? 
        "flex flex-col gap-4" : 
        "grid grid-cols-3 gap-4 h-full"
      }>
        {/* TO DO Column */}
        <div className={isHorizontalSplit ? 
          "flex flex-col" : 
          "flex flex-col min-h-0"
        }>
          {/* Column Header */}
          <div className="flex items-center gap-2 mb-3 shrink-0">
            <h3 className="font-semibold text-sm text-gray-900 dark:text-white">📝 {t('columns.todo')}</h3>
            <Badge variant="secondary" className="text-xs">
              {sortedTodoTasks.length}
            </Badge>
          </div>
          
          {/* Content - No scroll in horizontal (board scrolls), scroll in vertical (column scrolls) */}
          <div
            ref={todoListRef}
            className={isHorizontalSplit ?
              "space-y-2 pr-2" :
              "space-y-2 overflow-y-auto pr-2 scrollbar-hide"
            }
          >
            {sortedTodoTasks.map((task) => {
              const taskId = task.id || task.name;
              return (
                <PopAppear
                  key={taskId}
                  fresh={newlyAddedTodoIds.has(taskId)}
                  layoutId={`task-${taskId}`}
                >
                  <TaskCard task={task} status="todo" />
                </PopAppear>
              );
            })}
            {sortedTodoTasks.length === 0 && !isHorizontalSplit && (
              <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-8">
                {t('columns.noPendingTasks')}
              </div>
            )}
          </div>
        </div>

        {/* IN PROGRESS Column */}
        <div className={isHorizontalSplit ? 
          "flex flex-col" : 
          "flex flex-col min-h-0"
        }>
          {/* Column Header */}
          <div className="flex items-center gap-2 mb-3 shrink-0">
            <h3 className="font-semibold text-sm text-gray-900 dark:text-white">🚀 {t('columns.inProgress')}</h3>
            <Badge variant="secondary" className="text-xs">
              {inProgressTasks.length}
            </Badge>
          </div>
          
          {/* Content - No scroll in horizontal (board scrolls), scroll in vertical (column scrolls) */}
          <div className={isHorizontalSplit ? 
            "space-y-3 pr-2" : 
            "space-y-3 overflow-y-auto pr-2 scrollbar-hide"
          }>
            {inProgressTasks.map((task) => {
              const taskId = task.id || task.name;
              
              // Find the active node for this specific task
              const taskActiveNode = workflowDisplayedState?.activeNodes?.find(
                n => n.taskId === taskId || n.taskName === task.name
              );
              
              return (
                <div key={`in-progress-${taskId}`} className="min-w-0 space-y-0">
                  <motion.div
                    key={taskId}
                    className="min-w-0"
                    layoutId={`task-${taskId}`}
                    layout
                    transition={{ 
                      layout: {
                        type: "spring",
                        stiffness: 500,
                        damping: 35
                      }
                    }}
                  >
                    <TaskCard 
                      task={task} 
                      status="in-progress"
                    />
                  </motion.div>
                  <InlineNodeStatus node={taskActiveNode} />
                </div>
              );
            })}
            {inProgressTasks.length === 0 && !isHorizontalSplit && (
              <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-8">
                {t('columns.noTaskInProgress')}
              </div>
            )}
          </div>
        </div>

        {/* COMPLETED Column */}
        <div className={isHorizontalSplit ? 
          "flex flex-col" : 
          "flex flex-col min-h-0"
        }>
          {/* Column Header */}
          <div className="flex items-center gap-2 mb-3 shrink-0">
            <h3 className="font-semibold text-sm text-gray-900 dark:text-white">✅ {t('columns.completed')}</h3>
            <Badge variant="secondary" className="text-xs">
              {completedTasks.length}
            </Badge>
          </div>
          
          {/* Content - No scroll in horizontal (board scrolls), scroll in vertical (column scrolls) */}
          <div className={isHorizontalSplit ? 
            "space-y-2 pr-2" : 
            "space-y-2 overflow-y-auto pr-2 scrollbar-hide"
          }>
            {completedTasks.slice().reverse().map((task) => {
              const taskId = task.id || task.name;
              const isNewlyCompleted = newlyCompletedIds.has(taskId);
              
              return (
                <motion.div
                  key={taskId}
                  layoutId={`task-${taskId}`}
                  layout
                  transition={{ 
                    layout: {
                      type: "spring",
                      stiffness: 500,
                      damping: 35
                    }
                  }}
                  className="relative min-w-0"
                  style={{ isolation: 'isolate' }}
                >
                  {/* ✅ Golden shine effect for newly completed tasks */}
                  {isNewlyCompleted && (
                    <>
                      {/* Background glow pulse */}
                      <motion.div
                        className="absolute inset-0 rounded-lg pointer-events-none"
                        style={{ zIndex: 99 }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: [0, 1, 0.5, 0] }}
                        transition={{
                          duration: 1,
                          times: [0, 0.2, 0.5, 1],
                          ease: "easeInOut"
                        }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-yellow-200/60 via-yellow-100/80 to-yellow-200/60 dark:from-yellow-600/40 dark:via-yellow-400/60 dark:to-yellow-600/40 blur-sm" />
                      </motion.div>
                      
                      {/* Main shine effect */}
                      <motion.div
                        className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden"
                        style={{ zIndex: 100 }}
                      >
                        <motion.div
                          className="absolute inset-0"
                          initial={{ x: '-100%' }}
                          animate={{ x: '200%' }}
                          transition={{
                            duration: 0.7,
                            ease: [0.4, 0, 0.2, 1],
                            delay: 0.2
                          }}
                          style={{
                            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 20%, rgba(255,255,200,0.95) 40%, rgba(255,255,255,1) 50%, rgba(255,255,200,0.95) 60%, rgba(255,255,255,0.3) 80%, transparent 100%)',
                            boxShadow: '0 0 30px 10px rgba(255,255,150,0.8), inset 0 0 20px rgba(255,255,255,0.5)',
                            filter: 'blur(1px)'
                          }}
                        />
                      </motion.div>
                    </>
                  )}
                  <div className="relative z-10">
                    <TaskCard 
                      task={task} 
                      status="completed"
                    />
                  </div>
                </motion.div>
              );
            })}
            {completedTasks.length === 0 && !isHorizontalSplit && (
              <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-8">
                {t('columns.noCompletedTasks')}
              </div>
            )}
          </div>
        </div>
      </div>
    </LayoutGroup>
  );
}
