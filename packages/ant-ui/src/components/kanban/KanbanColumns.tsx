import { Badge } from '@/ui/badge';
import { TaskCard } from '../TaskCard';
import { motion, LayoutGroup } from 'framer-motion';
import { UnifiedTask } from '@/types/task';

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
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ 
                    layout: { duration: 0.3 },
                    opacity: { duration: 0.2 }
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
          <div className="space-y-2">
            {inProgressTask && (
              <motion.div
                key={inProgressTask.id || inProgressTask.name}
                layout
                initial={
                  newlyInProgressId === (inProgressTask.id || inProgressTask.name)
                    ? { opacity: 0, x: -50 }
                    : false
                }
                animate={{ opacity: 1, x: 0 }}
                transition={{ 
                  layout: { duration: 0.3 },
                  opacity: { duration: 0.3, delay: 0.4 },
                  x: { duration: 0.3, delay: 0.4 }
                }}
                onAnimationComplete={() => {
                  if (newlyInProgressId === (inProgressTask.id || inProgressTask.name)) {
                    onInProgressAnimationComplete();
                  }
                }}
              >
                <TaskCard task={inProgressTask} status="in-progress" />
              </motion.div>
            )}
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
                  layout
                  initial={isNewlyCompleted ? { opacity: 0, x: 50 } : false}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ 
                    layout: { duration: 0.3 },
                    opacity: { duration: 0.3, delay: 0.2 },
                    x: { duration: 0.3, delay: 0.2 }
                  }}
                  className="relative overflow-hidden"
                >
                  {isNewlyCompleted && (
                    <>
                      <div className="absolute inset-0 bg-green-100 dark:bg-green-900/30 rounded-lg animate-pulse" />
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 dark:via-white/20 to-transparent rounded-lg"
                        initial={{ x: '-100%' }}
                        animate={{ x: '200%' }}
                        transition={{ 
                          duration: 0.8, 
                          delay: 0.3,
                          ease: 'easeInOut'
                        }}
                        onAnimationComplete={() => {
                          setTimeout(() => {
                            onShineComplete(taskId);
                          }, 500);
                        }}
                      />
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

