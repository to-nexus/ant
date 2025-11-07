import { Badge } from '@/ui/badge';
import { TaskCard } from '../TaskCard';
import { motion, LayoutGroup } from 'framer-motion';
import { UnifiedTask } from '@/types/task';
import { ActiveNodeIndicator } from './ActiveNodeIndicator';

interface KanbanColumnsProps {
  todoTasks: UnifiedTask[];
  inProgressTask: UnifiedTask | null;
  completedTasks: UnifiedTask[];
  newlyCompletedIds: Set<string>;
  newlyInProgressId: string | null;
  splitLayout: 'horizontal' | 'vertical';
  onShineComplete: (taskId: string) => void;
  onInProgressAnimationComplete: () => void;
}

/**
 * KanbanColumns - Three column layout (To Do, In Progress, Completed)
 * Handles task card rendering with animations
 * 
 * Layout:
 * - Horizontal split (left/right): Columns arranged vertically (flex-col)
 * - Vertical split (top/bottom): Columns arranged horizontally (grid-cols-3)
 */
export function KanbanColumns({
  todoTasks,
  inProgressTask,
  completedTasks,
  newlyCompletedIds,
  newlyInProgressId,
  splitLayout,
  onShineComplete,
  onInProgressAnimationComplete
}: KanbanColumnsProps) {
  // Horizontal split: vertical column layout (flex-col)
  // Vertical split: horizontal column layout (grid-cols-3)
  const isHorizontalSplit = splitLayout === 'horizontal';
  
  return (
    <LayoutGroup>
      <div className={isHorizontalSplit ? "flex flex-col gap-4 pt-4" : "grid grid-cols-3 gap-4 pt-4"}>
        {/* TO DO Column */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-semibold text-sm text-gray-900 dark:text-white">📝 To Do</h3>
            <Badge variant="secondary" className="text-xs">
              {todoTasks.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {todoTasks.map((task) => {
              const taskId = task.id || task.name;
              return (
                <motion.div
                  key={taskId}
                  layoutId={`task-${taskId}`}  // ✅ Critical: enables shared layout animations across columns
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ 
                    layout: {
                      type: "spring",
                      stiffness: 500,
                      damping: 35
                    },
                    opacity: { duration: 0.2 },
                    scale: { duration: 0.2 }
                  }}
                >
                  <TaskCard task={task} status="todo" />
                </motion.div>
              );
            })}
            {todoTasks.length === 0 && (
              <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-8">
                No pending tasks
              </div>
            )}
          </div>
        </div>

        {/* IN PROGRESS Column */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-semibold text-sm text-gray-900 dark:text-white">🚀 In Progress</h3>
            <Badge variant="secondary" className="text-xs">
              {inProgressTask ? 1 : 0}
            </Badge>
          </div>
          <div className="space-y-3">
            {inProgressTask && (() => {
              const taskId = inProgressTask.id || inProgressTask.name;
              const isNewlyInProgress = newlyInProgressId === taskId;
              
              return (
                <div key="in-progress-with-indicator" className="space-y-2">
                  <motion.div
                    key={taskId}
                    layoutId={`task-${taskId}`}  // ✅ Critical: enables shared layout animations
                    layout
                    initial={isNewlyInProgress ? { opacity: 0 } : false}
                    animate={{ opacity: 1 }}
                    transition={{ 
                      layout: {
                        type: "spring",
                        stiffness: 500,
                        damping: 35,
                        delay: isNewlyInProgress ? 0.4 : 0  // ✅ Delay for newly in-progress
                      },
                      opacity: {
                        duration: 0.3,
                        delay: isNewlyInProgress ? 0.4 : 0
                      }
                    }}
                    onAnimationComplete={() => {
                      if (isNewlyInProgress) {
                        onInProgressAnimationComplete();
                      }
                    }}
                  >
                    <TaskCard task={inProgressTask} status="in-progress" />
                  </motion.div>
                  
                  {/* ✅ Active Node/Actor Indicator - Below the in-progress card */}
                  <ActiveNodeIndicator />
                </div>
              );
            })()}
            {!inProgressTask && (
              <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-8">
                No task in progress
              </div>
            )}
          </div>
        </div>

        {/* COMPLETED Column */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-semibold text-sm text-gray-900 dark:text-white">✅ Completed</h3>
            <Badge variant="secondary" className="text-xs">
              {completedTasks.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {completedTasks.slice().reverse().map((task) => {
              const taskId = task.id || task.name;
              const isNewlyCompleted = newlyCompletedIds.has(taskId);
              
              return (
                <motion.div
                  key={taskId}
                  layoutId={`task-${taskId}`}  // ✅ Critical: enables shared layout animations
                  layout
                  initial={isNewlyCompleted ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  transition={{ 
                    layout: {
                      type: "spring",
                      stiffness: 500,
                      damping: 35
                    },
                    opacity: { duration: 0.2 }
                  }}
                  className="relative"
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
                        onAnimationComplete={() => {
                          // Remove from newly completed set after shine animation
                          setTimeout(() => {
                            onShineComplete(taskId);
                          }, 100);
                        }}
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
                    <TaskCard task={task} status="completed" />
                  </div>
                </motion.div>
              );
            })}
            {completedTasks.length === 0 && (
              <div className="text-center text-gray-500 dark:text-gray-400 text-sm py-8">
                No completed tasks yet
              </div>
            )}
          </div>
        </div>
      </div>
    </LayoutGroup>
  );
}

