/**
 * Common Types
 * Shared types across the UI application
 * 
 * NOTE: These should match backend types from:
 * - packages/ant-cli/src/agents/architect/types/task.ts (TaskTiming, TaskTokenUsage)
 * - packages/ant-cli/src/agents/architect/graph/common/timing/JobTimingManager.ts (JobTiming)
 */

/**
 * Task Timing Information
 * Tracks when a task started, completed, paused, etc.
 */
export interface TaskTiming {
  startedAt?: string;
  completedAt?: string;
  pausedAt?: string;
  resumedAt?: string;
  totalPausedDuration: number;
  elapsedTime?: number;
  duration?: string;
}

/**
 * Task Token Usage Information
 * Tracks LLM token consumption for a task
 */
export interface TaskTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * Job Timing Information
 * Tracks job-level timing (entire code/design/learn job)
 */
export interface JobTiming {
  startedAt: string;
  lastResumedAt?: string;
  pausedAt?: string;
  completedAt?: string;
  totalPausedDuration: number;
  estimatingDuration?: number;
  totalElapsedTime?: number;
}

