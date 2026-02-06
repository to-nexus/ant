/**
 * Session Domain Models
 * 
 * Frontend session types. Session/SessionState are FE VIEW MODELS
 * (different structure from BE). Shared types come from @ant/shared.
 */

import type { TaskTokenUsage, JobTiming, InterruptionDetails, BaseTask } from '@ant/shared';

// Re-export shared types (canonical source: @ant/shared)
export type { TaskType, TaskStatus } from '@ant/shared';
export type { InterruptionReason, InterruptionDetails } from '@ant/shared';
export type { BaseTask } from '@ant/shared';

// ============================================
// Task (alias for BaseTask from @ant/shared)
// ============================================

/** FE alias for BaseTask. Guaranteed identical to backend. */
export type Task = BaseTask;

// ============================================
// Session Status
// ============================================

export type SessionStatus = 'active' | 'paused' | 'completed' | 'cancelled';

// ============================================
// Session State (Execution Snapshot)
// ============================================

export interface SessionState {
  jobId?: string;

  // Task Queue
  taskQueue: Task[];
  completedTasks: string[];
  completedTasksDetails?: Task[];
  currentTask?: Task | null;
  retries?: number;
  maxRetries?: number;
  previousAttempts?: any[];
  enforcementHistory?: any[];
  lastViolations?: any[];
  resolvedCategories?: any[];

  // Interruption
  interruption?: InterruptionDetails;

  // Job Timing
  jobTiming?: JobTiming;

  // Token Usage
  tokenUsage?: TaskTokenUsage;

  // Recursion Tracking
  recursionCount?: number;
  recursionLimit?: number;
}

// ============================================
// Session (FE View Model)
// ============================================

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

// ============================================
// Session State Context (FE runtime state)
// ============================================

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
