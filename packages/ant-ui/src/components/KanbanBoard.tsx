import { useStore } from '@/lib/store';
import { Card, CardHeader, CardTitle, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useEffect, useState } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { KanbanData } from '@/lib/api';
import { TaskCard } from './TaskCard';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

/**
 * KanbanBoard Component - SSE VERSION
 * 
 * Displays tasks in a 3-column Kanban board: To Do | In Progress | Completed
 * 
 * Architecture:
 * - Backend provides complete, ready-to-render data via SSE stream
 * - Frontend receives real-time updates (no polling!)
 * - Instant updates when queue changes, task starts/completes
 */
export function KanbanBoard() {
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const isRunning = useStore((state) => state.isRunning);
  const setRunning = useStore((state) => state.setRunning);
  const setCurrentTask = useStore((state) => state.setCurrentTask);
  const setSession = useStore((state) => state.setSession);
  const [kanbanData, setKanbanData] = useState<KanbanData>({
    todo: [],
    inProgress: null,
    completed: []
  });
  
  // Track newly completed tasks for shine animation
  const [newlyCompletedIds, setNewlyCompletedIds] = useState<Set<string>>(new Set());
  const [previousCompletedIds, setPreviousCompletedIds] = useState<Set<string>>(new Set());
  
  // Track newly in-progress task for delayed animation
  const [newlyInProgressId, setNewlyInProgressId] = useState<string | null>(null);
  const [previousInProgressId, setPreviousInProgressId] = useState<string | null>(null);
  
  // Track previous data source to detect task completion
  const [previousDataSource, setPreviousDataSource] = useState<string | undefined>(undefined);

  // SSE connection for real-time updates
  useEffect(() => {
    if (!selectedProject || !selectedFeature) {
      setKanbanData({ todo: [], inProgress: null, completed: [] });
      return;
    }

    let eventSource: EventSource | null = null;
    let isMounted = true;

    // Function to fetch session data (fallback when task is not running)
    const fetchSessionData = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/projects/${selectedProject}/features/${selectedFeature}/kanban`
        );
        if (response.ok && isMounted) {
          const data = await response.json();
          console.log('[Kanban] Loaded session data (task not running)');
          setKanbanData(data);
        }
      } catch (error) {
        console.error('[Kanban] Failed to fetch session data:', error);
      }
    };

    // Try SSE connection first (for live tasks)
    console.log(`[Kanban] Attempting SSE connection to ${selectedProject}/${selectedFeature}`);
    
    eventSource = new EventSource(
      `${API_BASE}/projects/${selectedProject}/features/${selectedFeature}/kanban/stream`
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (isMounted) {
          console.log('[Kanban SSE] Received update:', {
            todoCount: data.todo?.length ?? 0,
            hasInProgress: !!data.inProgress,
            completedCount: data.completed?.length ?? 0,
            isEstimating: data.isEstimating,
            dataSource: data.dataSource
          });
          setKanbanData(data);
        }
      } catch (error) {
        console.error('[Kanban SSE] Failed to parse data:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.log('[Kanban SSE] Connection error, but keeping connection alive for session file updates');
      // ✅ DON'T close the connection!
      // SSE will auto-reconnect, allowing us to receive session file updates
      // even when no task is running
      
      // Note: If the connection is truly dead (server stopped), 
      // the browser will eventually stop retrying
    };

    console.log(`[Kanban SSE] Connecting to ${selectedProject}/${selectedFeature}`);

    return () => {
      isMounted = false;
      if (eventSource) {
        console.log('[Kanban SSE] Disconnecting');
        eventSource.close();
      }
    };
  }, [selectedProject, selectedFeature]);
  
  // Detect newly completed tasks
  useEffect(() => {
    const currentCompletedIds = new Set(kanbanData.completed.map(task => task.id || task.name));
    const newIds = new Set<string>();
    
    currentCompletedIds.forEach(id => {
      if (!previousCompletedIds.has(id)) {
        newIds.add(id);
      }
    });
    
    if (newIds.size > 0) {
      setNewlyCompletedIds(newIds);
      setPreviousCompletedIds(currentCompletedIds);
    }
  }, [kanbanData.completed]);
  
  // Detect newly in-progress task
  useEffect(() => {
    const currentInProgressId = kanbanData.inProgress?.id || kanbanData.inProgress?.name || null;
    
    if (currentInProgressId && currentInProgressId !== previousInProgressId) {
      setNewlyInProgressId(currentInProgressId);
      setPreviousInProgressId(currentInProgressId);
      
      // Clear after animation completes
      setTimeout(() => {
        setNewlyInProgressId(null);
      }, 1000);
    }
  }, [kanbanData.inProgress]);
  
  // ✅ Detect task completion/stop: live → session transition
  useEffect(() => {
    const currentDataSource = kanbanData.dataSource;
    
    // If we were on 'live' or 'estimating' and now switched to 'session', task has ended
    if ((previousDataSource === 'live' || previousDataSource === 'estimating') && 
        currentDataSource === 'session' && 
        isRunning) {
      console.log('[KanbanBoard] Task ended detected (live→session), updating UI state');
      setRunning(false);
    }
    
    setPreviousDataSource(currentDataSource);
  }, [kanbanData.dataSource, previousDataSource, isRunning, setRunning]);

  const totalTasks = kanbanData.todo.length + 
    (kanbanData.inProgress ? 1 : 0) + 
    kanbanData.completed.length;

  // Show empty state if no tasks AND not estimating
  if (totalTasks === 0 && !kanbanData.isEstimating) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>📋 Task Board</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            {selectedProject && selectedFeature ? (
              <div>
                <div className="mb-2">📋 No tasks yet.</div>
                <div className="text-xs">
                  Run a task to start generating the task queue.
                </div>
              </div>
            ) : selectedProject ? (
              <div>Please select a feature to view tasks.</div>
            ) : (
              <div>Please select a project to view tasks.</div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>📋 Task Board</CardTitle>
            {kanbanData.dataSource && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                <span className="text-xs text-gray-600 font-medium">Data Source:</span>
                <div className="flex items-center gap-1.5">
                  {kanbanData.dataSource === 'live' ? (
                    <>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                      </span>
                      <span className="text-xs font-semibold text-red-600">Real-time</span>
                    </>
                  ) : kanbanData.dataSource === 'estimating' ? (
                    <>
                      <span className="animate-spin text-xs">⏳</span>
                      <span className="text-xs font-semibold text-blue-600">Estimating</span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs">📄</span>
                      <span className="text-xs font-semibold text-gray-600">Session File</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Recursion Limit with Progress Bar - Always visible */}
            <div className="relative px-3 py-1.5 rounded-md bg-purple-50 dark:bg-purple-950/30 border-2 border-purple-300 dark:border-purple-800 min-w-[140px]">
              {/* Background Progress Bar */}
              <div className="absolute inset-0 rounded-md overflow-hidden">
                <div 
                  className="h-full bg-purple-300 dark:bg-purple-800/50 border-r-2 border-purple-400 dark:border-purple-700 transition-all duration-500 ease-out"
                  style={{ 
                    width: `${kanbanData.recursionLimit 
                      ? Math.min(((kanbanData.recursionCount || 0) / kanbanData.recursionLimit) * 100, 100) 
                      : 0}%` 
                  }}
                />
              </div>
              {/* Text */}
              <div className="relative z-10 flex items-center justify-center gap-1.5">
                <span className="text-xs text-purple-700 dark:text-purple-300 font-semibold">
                  {kanbanData.recursionCount || 0}/{kanbanData.recursionLimit || 50} Recursion
                </span>
              </div>
            </div>
            
            {/* Tasks with Progress Bar */}
            <div className="relative px-3 py-1.5 rounded-md bg-green-50 dark:bg-green-950/30 border-2 border-green-300 dark:border-green-800 min-w-[140px]">
              {/* Background Progress Bar */}
              <div className="absolute inset-0 rounded-md overflow-hidden">
                <div 
                  className="h-full bg-green-300 dark:bg-green-800/50 border-r-2 border-green-400 dark:border-green-700 transition-all duration-500 ease-out"
                  style={{ width: `${totalTasks > 0 ? Math.min((kanbanData.completed.length / totalTasks) * 100, 100) : 0}%` }}
                />
              </div>
              {/* Text */}
              <div className="relative z-10 flex items-center justify-center gap-1.5">
                <span className="text-xs text-green-700 dark:text-green-300 font-semibold">
                  {kanbanData.completed.length}/{totalTasks} Tasks
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="bg-white dark:bg-gray-800 dark:bg-gray-800">
        {/* Paused State: Show resume prompt (only when NOT running) */}
        {kanbanData.pausedDueToLimit && !kanbanData.isEstimating && !isRunning ? (
          <div className="mb-4 p-6 bg-orange-50 dark:bg-orange-950 border-2 border-orange-300 dark:border-orange-700 rounded-lg">
            <div className="flex items-start gap-4">
              <div className="text-3xl">⏸️</div>
              <div className="flex-1">
                <div className="font-semibold text-lg text-orange-900 dark:text-orange-200 mb-2">
                  Task paused due to recursion limit
                </div>
                <div className="text-sm text-orange-800 dark:text-orange-300 mb-4">
                  {kanbanData.tasksRemaining} task{kanbanData.tasksRemaining !== 1 ? 's' : ''} remaining. 
                  The agent will continue from where it left off.
                </div>
                <Button
                  onClick={async () => {
                    if (!selectedProject || !selectedFeature) return;
                    
                    console.log('[KanbanBoard] Resume Task clicked');
                    
                    // ✅ 1. Immediately update UI state
                    setRunning(true, undefined, 'generate');
                    
                    try {
                      // ✅ 2. Start task execution with SSE
                      const { executeCodeTask } = await import('@/lib/cli');
                      const { fetchFeatureSession } = await import('@/lib/api');
                      
                      const taskExecution = executeCodeTask({
                        projectId: selectedProject,
                        featureName: selectedFeature,
                        task: 'code',
                        agent: 'architect',
                        mode: 'generate',
                        language: 'en',
                      });
                      
                      // ✅ 3. Store task execution in global state
                      setCurrentTask(taskExecution);
                      
                      // ✅ 4. Update with actual taskId once ready
                      if (taskExecution.onTaskIdReady) {
                        taskExecution.onTaskIdReady((taskId) => {
                          console.log('[KanbanBoard] Task ID ready:', taskId);
                          setRunning(true, taskId, 'generate');
                        });
                      }
                      
                      // ✅ 5. Handle task completion/exit
                      taskExecution.on('exit', async (code, _signal) => {
                        console.log(`[KanbanBoard] Task exited with code ${code}`);
                        setRunning(false);
                        setCurrentTask(null);
                        
                        // Reload session after task completes
                        if (selectedProject && selectedFeature) {
                          try {
                            const session = await fetchFeatureSession(selectedProject, selectedFeature);
                            setSession(session ?? undefined);
                          } catch (error) {
                            console.error('[KanbanBoard] Failed to reload session:', error);
                          }
                        }
                      });
                      
                      console.log('[KanbanBoard] Task resumed successfully');
                    } catch (error) {
                      console.error('[KanbanBoard] Failed to resume task:', error);
                      setRunning(false);
                      setCurrentTask(null);
                      alert('Failed to resume task. Please try again.');
                    }
                  }}
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                >
                  ▶️ Resume Task
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Estimating State: Show only banner, hide columns */}
        {kanbanData.isEstimating ? (
          <div className="p-8 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex flex-col items-center justify-center gap-4 text-blue-900">
              <div className="text-4xl animate-spin">⏳</div>
              <div className="text-center">
                <div className="font-semibold text-lg mb-1">Breaking down tasks...</div>
                <div className="text-sm text-blue-700">Analyzing requirements and creating task queue</div>
              </div>
            </div>
          </div>
        ) : (
          <LayoutGroup>
          <div className="grid grid-cols-3 gap-4 pt-4">
          {/* TO DO Column */}
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm text-gray-900 dark:text-white">📝 To Do</h3>
              <Badge variant="secondary" className="text-xs">
                {kanbanData.todo.length}
              </Badge>
            </div>
            <div className="space-y-2">
              {kanbanData.todo.map((task) => (
                <motion.div
                  key={task.id}
                  layoutId={`task-${task.id}`}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ 
                    layout: {
                      type: "spring",
                      stiffness: 500,
                      damping: 35
                    }
                  }}
                >
                  <TaskCard
                    task={{
                      ...task,
                      status: 'todo' as const
                    }}
                    status="todo"
                  />
                </motion.div>
              ))}
            </div>
          </div>

          {/* IN PROGRESS Column */}
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm text-gray-900 dark:text-white">🚀 In Progress</h3>
              <Badge variant="secondary" className="text-xs">
                {kanbanData.inProgress ? 1 : 0}
              </Badge>
            </div>
            <div className="space-y-2">
              {kanbanData.inProgress ? (() => {
                const taskId = kanbanData.inProgress.id || kanbanData.inProgress.name;
                const isNewlyInProgress = newlyInProgressId === taskId;
                
                return (
                  <motion.div
                    key={taskId}
                    layoutId={`task-${taskId}`}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ 
                      layout: {
                        type: "spring",
                        stiffness: 500,
                        damping: 35,
                        delay: isNewlyInProgress ? 0.4 : 0  // Delay for newly in-progress task
                      },
                      opacity: {
                        delay: isNewlyInProgress ? 0.4 : 0
                      }
                    }}
                  >
                    <TaskCard
                      task={{
                        ...kanbanData.inProgress,
                        status: 'in-progress' as const
                      }}
                      status="in-progress"
                    />
                  </motion.div>
                );
              })() : null}
            </div>
          </div>

          {/* COMPLETED Column */}
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm text-gray-900 dark:text-white">✅ Completed</h3>
              <Badge variant="secondary" className="text-xs">
                {kanbanData.completed.length}
              </Badge>
            </div>
            <div className="space-y-2">
              {kanbanData.completed.slice().reverse().map((task) => {
                const taskId = task.id || task.name;
                const isNewlyCompleted = newlyCompletedIds.has(taskId);
                
                return (
                  <motion.div
                    key={taskId}
                    layoutId={`task-${taskId}`}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ 
                      layout: {
                        type: "spring",
                        stiffness: 500,
                        damping: 35
                      }
                    }}
                    className="relative"
                    style={{ isolation: 'isolate' }}
                  >
                    {/* Shine effect overlay - only for newly completed */}
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
                          <div className="absolute inset-0 bg-gradient-to-r from-yellow-200/60 via-yellow-100/80 to-yellow-200/60 blur-sm" />
                        </motion.div>
                        
                        {/* Main shine effect */}
                        <motion.div
                          className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden"
                          style={{ zIndex: 100 }}
                          onAnimationComplete={() => {
                            // Remove from newly completed set after shine animation
                            setTimeout(() => {
                              setNewlyCompletedIds(prev => {
                                const next = new Set(prev);
                                next.delete(taskId);
                                return next;
                              });
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
                    <TaskCard
                      task={{
                        ...task,
                        status: 'completed' as const,
                        completed: true
                      }}
                      status="completed"
                    />
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
        </LayoutGroup>
        )}
      </CardContent>
    </Card>
  );
}
