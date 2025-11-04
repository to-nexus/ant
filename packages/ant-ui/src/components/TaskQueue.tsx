import { useStore } from '@/lib/store';
import { Card, CardHeader, CardTitle, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';

export function TaskQueue() {
  const session = useStore((state) => state.session);

  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Task Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            No active session. Please select a project to view tasks.
          </div>
        </CardContent>
      </Card>
    );
  }

  const completedTasks = session.state?.completedTasks ?? [];
  const queuedTasks = session.state?.taskQueue ?? [];
  
  const totalTasks = completedTasks.length + queuedTasks.length;

  if (totalTasks === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Task Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            No tasks in queue. The task queue is empty.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Task Queue</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
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

          {queuedTasks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 text-blue-700">
                ⏳ Remaining ({queuedTasks.length})
              </h3>
              <div className="space-y-2">
                {queuedTasks.map((task: any, index: number) => (
                  <div
                    key={task.id || index}
                    className="p-3 rounded-lg border border-blue-200 bg-blue-50/50"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="bg-blue-100">
                        {completedTasks.length + index + 1}
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
