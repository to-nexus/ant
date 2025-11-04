export interface LogEntry {
  type: 'info' | 'stdout' | 'stderr' | 'error';
  message: string;
  timestamp: string;
}

export interface TaskStatus {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ExecuteTaskParams {
  project: string;
  task: 'design' | 'code' | 'learn';
  agent?: 'architect';
  mode?: 'generate' | 'refactor' | 'explain';
  enableEvaluation?: boolean;
}