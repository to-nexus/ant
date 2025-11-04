import { useStore } from '@/lib/store';
import { Card, CardHeader, CardTitle, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { useEffect, useState } from 'react';
import { fetchQueueStatus, QueueStatus } from '@/lib/api';

export function TaskQueue() {
  const session = useStore((state) => state.session);
  const currentTaskId = useStore((state) => state.currentTaskId);
  const selectedProject = useStore((state) => state.selectedProject);
  const selectedFeature = useStore((state) => state.selectedFeature);
  const [liveQueue, setLiveQueue] = useState<QueueStatus | null>(null);

  // Poll live queue status when task is running
  useEffect(() => {
    if (!currentTaskId) {
      setLiveQueue(null);
      return;
    }

    const pollQueue = async () => {
      try {
        const queueStatus = await fetchQueueStatus(currentTaskId);
        setLiveQueue(queueStatus);
      } catch (error) {
        console.error('Failed to fetch queue status:', error);
      }
    };

    // Initial fetch
    pollQueue();

    // Poll every second for real-time updates
    const intervalId = setInterval(pollQueue, 1000);

    return () => {
      clearInterval(intervalId);
      setLiveQueue(null);
    };
  }, [currentTaskId]);

  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Task Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            {selectedProject && selectedFeature ? (
              <div>
                <div className="mb-2">📋 No session data available yet.</div>
                <div className="text-xs">
                  Run a task to start generating the task queue.
                </div>
              </div>
            ) : selectedProject ? (
              <div>Please select a feature to view tasks.</div>
            ) : (
              <div>Please select a project and feature to view tasks.</div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Use live queue if task is running AND we have live data, otherwise use session data
  const isTaskRunning = Boolean(currentTaskId);
  const completedTasks = session.state?.completedTasks ?? [];
  
  // Only use live queue if we actually have live data (currentTask or non-empty queue)
  const hasLiveData = liveQueue && (liveQueue.currentTask || liveQueue.queue.length > 0);
  const queuedTasks = isTaskRunning && hasLiveData
    ? liveQueue.queue 
    : (session.state?.taskQueue ?? []);
  const currentTask = isTaskRunning && hasLiveData && liveQueue?.currentTask 
    ? liveQueue.currentTask 
    : null;
  
  const totalTasks = completedTasks.length + queuedTasks.length + (currentTask ? 1 : 0);

  if (totalTasks === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Task Queue {isTaskRunning && <Badge className="ml-2 bg-green-500">Live</Badge>}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground text-center py-4">
            <div className="text-3xl mb-2">📭</div>
            <div className="font-medium text-gray-700">Task queue is empty</div>
            <div className="text-xs mt-1">
              {selectedProject && selectedFeature 
                ? 'Execute a task to populate the queue'
                : 'Select a project and feature, then run a task'}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Task Queue 
          {isTaskRunning && <Badge className="bg-green-500 text-white">🔴 Live</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Current Task (Real-time) */}
          {currentTask && (
            <div>
              <h3 className="text-sm font-semibold mb-2 text-orange-700">
                ▶️ Current Task
              </h3>
              <div className="p-3 rounded-lg border-2 border-orange-400 bg-orange-50 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="bg-orange-200 border-orange-400">
                    NOW
                  </Badge>
                  <span className="text-sm font-bold text-orange-900">
                    {currentTask.name}
                  </span>
                </div>
                <div className="text-xs text-orange-700 ml-14">
                  Type: {currentTask.type} • Status: {currentTask.status}
                </div>
              </div>
            </div>
          )}

          {/* Completed Tasks */}
          {completedTasks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 text-green-700">
                ✅ Completed ({completedTasks.length})
              </h3>
              <div className="space-y-2">
                {completedTasks.map((taskId, index) => (
                  <div
                    key={taskId}
                    className="p-3 rounded-lg border border-green-200 bg-green-50/50 opacity-70"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-green-100">
                        {index + 1}
                      </Badge>
                      <span className="text-sm font-medium text-green-900 line-through">
                        {taskId}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Queued Tasks (Real-time or Session) */}
          {queuedTasks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 text-blue-700">
                ⏳ Remaining ({queuedTasks.length})
              </h3>
              <div className="space-y-2">
                {queuedTasks.map((task: any, index: number) => (
                  <div
                    key={task.id || task.name || index}
                    className="p-3 rounded-lg border border-blue-200 bg-blue-50/50"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="bg-blue-100">
                        {completedTasks.length + (currentTask ? 1 : 0) + index + 1}
                      </Badge>
                      <span className="text-sm font-medium text-blue-900">
                        {task.name || task.id || 'Unnamed Task'}
                      </span>
                    </div>
                    {task.description && (
                      <p className="text-xs text-blue-700 ml-12 mt-1">
                        {task.description}
                      </p>
                    )}
                    {task.type && (
                      <p className="text-xs text-blue-600 ml-12">
                        Type: {task.type}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
