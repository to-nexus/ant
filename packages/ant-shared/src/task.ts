/**
 * Task & Kanban Types
 * 
 * Core task types used for decomposition, Kanban board, and SSE updates.
 * Single source of truth - both BE and FE import from here.
 */

import type { DecomposableJobType, JobTiming } from './job';
import type { InterruptionDetails } from './interruption';

// ============================================
// Task Types
// ============================================

/**
 * Task types used in decomposition
 * - setup: Environment/config setup (Code Job)
 * - feature: Feature implementation (Code Job)
 * - error: Error fixing (Code Job)
 * - explain: Explanation task (Code Job)
 * - doc: Document generation (Design Job)
 */
export type TaskType = 'setup' | 'feature' | 'error' | 'explain' | 'doc';

/** Task status in Kanban flow */
export type TaskStatus = 'todo' | 'in-progress' | 'completed';

// ============================================
// Task Timing & Token Usage
// ============================================

/** Timing information for a single task */
export interface TaskTiming {
  startedAt?: string;
  completedAt?: string;
  pausedAt?: string;
  resumedAt?: string;
  totalPausedDuration: number;
  elapsedTime?: number;
  duration?: string;
}

/** LLM token consumption for a task or aggregate */
export interface TaskTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

// ============================================
// Base Task
// ============================================

/** Base task interface shared by all job types */
export interface BaseTask {
  id: string;
  name: string;
  type: TaskType;
  priority: number;
  description: string;
  completed?: boolean;
  interrupted?: boolean;
  timing?: TaskTiming;
  tokenUsage?: TaskTokenUsage;
  packages?: string[];
}

// ============================================
// Kanban Data (SSE → Frontend)
// ============================================

/**
 * Complete Kanban board data sent to frontend via SSE.
 * Produced by: KanbanBroadcaster (live), KanbanService (session/estimating)
 * Consumed by: Frontend sseSlice.updateKanban()
 */
export interface KanbanData {
  jobId?: string;
  todo: BaseTask[];
  inProgress: BaseTask | null;
  completed: BaseTask[];
  isEstimating: boolean;
  dataSource: 'live' | 'session' | 'estimating';

  // Recursion tracking
  recursionCount?: number;
  recursionLimit?: number;

  // Token usage (job-level aggregate)
  tokenUsage?: TaskTokenUsage;

  // Job metadata
  jobType?: DecomposableJobType;

  // Timing
  totalElapsedTime?: number;
  jobTiming?: JobTiming;

  // Interruption state
  interruption?: InterruptionDetails;
}
