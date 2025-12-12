import { Session } from '@/domain/models/session';
import { Card, CardHeader, CardTitle, CardContent } from '@/presentation/components/common/card';
import { Badge } from '@/presentation/components/common/badge';

interface SessionViewProps {
  session: Session | undefined;
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getStatusVariant(status: Session['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active':
      return 'default';
    case 'paused':
      return 'secondary';
    case 'completed':
      return 'outline';
    case 'cancelled':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function SessionView({ session }: SessionViewProps) {
  if (!session) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>No Session</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            No active session available. Please select a project to view session details.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Session Details</CardTitle>
          <Badge variant={getStatusVariant(session.status)}>
            {session.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Session ID</p>
              <p className="text-sm font-mono mt-1">{session.id}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Project ID</p>
              <p className="text-sm font-mono mt-1">{session.projectId}</p>
            </div>
          </div>

          {session.description && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Description</p>
              <p className="text-sm mt-1 break-words whitespace-pre-wrap">{session.description}</p>
            </div>
          )}

          {session.goals && session.goals.length > 0 && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Goals</p>
              <ul className="list-disc list-inside text-sm mt-1 space-y-1">
                {session.goals.map((goal, index) => (
                  <li key={index}>{goal}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Created At</p>
              <p className="text-sm mt-1">{formatTimestamp(session.createdAt)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Updated At</p>
              <p className="text-sm mt-1">{formatTimestamp(session.updatedAt)}</p>
            </div>
          </div>

          {session.metadata && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Progress</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-2 bg-muted rounded">
                  <span className="text-sm">Total Tasks</span>
                  <span className="text-sm font-semibold">{session.metadata.totalTasks ?? 0}</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-muted rounded">
                  <span className="text-sm">Completed</span>
                  <span className="text-sm font-semibold text-green-600">{session.metadata.completedTasks ?? 0}</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-muted rounded">
                  <span className="text-sm">Failed</span>
                  <span className="text-sm font-semibold text-red-600">{session.metadata.failedTasks ?? 0}</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-muted rounded">
                  <span className="text-sm">Blocked</span>
                  <span className="text-sm font-semibold text-yellow-600">{session.metadata.blockedTasks ?? 0}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}