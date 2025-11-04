export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';

export type TaskType = 
  | 'research'
  | 'implementation'
  | 'testing'
  | 'documentation'
  | 'review'
  | 'deployment'
  | 'bugfix'
  | 'refactor';

export interface Task {
  id: string;
  type: TaskType;
  description: string;
  status: TaskStatus;
  dependencies: string[];
  assignee?: string;
  estimatedHours?: number;
  actualHours?: number;
  startedAt?: string;
  completedAt?: string;
  blockedReason?: string;
  notes?: string;
  tags?: string[];
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export type SessionStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface SessionState {
  taskQueue: Task[];
  completedTasks: string[];
  retries?: number;
  maxRetries?: number;
  previousAttempts?: any[];
  enforcementHistory?: any[];
  lastViolations?: any[];
  resolvedCategories?: any[];
}

export interface Session {
  id: string;
  projectId: string;
  status: SessionStatus;
  tasks: Task[];
  state?: SessionState;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  pausedAt?: string;
  cancelledAt?: string;
  metadata?: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    blockedTasks: number;
    totalEstimatedHours: number;
    totalActualHours: number;
  };
  description?: string;
  goals?: string[];
}

export interface SessionStateContext {
  currentTaskId?: string;
  isRunning: boolean;
  isPaused: boolean;
  startTime?: number;
  pauseTime?: number;
  elapsedTime: number;
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
  errors: Array<{
    taskId: string;
    message: string;
    timestamp: string;
  }>;
  warnings: Array<{
    taskId: string;
    message: string;
    timestamp: string;
  }>;
}