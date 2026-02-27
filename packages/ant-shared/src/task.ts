/**
 * Task & Kanban Types
 * 
 * Core task types used for decomposition, Kanban board, and SSE updates.
 * Single source of truth - both BE and FE import from here.
 */

import type { JobTiming } from './job';
import type { InterruptionDetails } from './interruption';

// ============================================
// Task Types
// ============================================

/**
 * Task types used in decomposition
 * - setup: Environment/config setup (Code Job)
 * - feature: Feature implementation (Code Job)
 * - testgen: Test code generation after features complete (Code Job)
 * - error: Error fixing (Code Job)
 * - verification: Build & runtime verification (Code Job)
 * - explain: Explanation task (Code Job)
 * - doc: Document generation (Design Job, Code Job)
 */
export type TaskType = 'setup' | 'feature' | 'testgen' | 'error' | 'verification' | 'explain' | 'doc';

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

  /**
   * Exclusive execution flag (set by decompose).
   * When true, this task cannot run concurrently with any other task.
   * The orchestrator waits until all running tasks complete before starting
   * an exclusive task, and no new tasks are started until it finishes.
   *
   * Code job: setup, error, final → exclusive: true
   * Design job: api-contract → exclusive: true
   */
  exclusive?: boolean;

  /**
   * Parallel execution group ID (set by decompose LLM).
   * Tasks sharing the same parallelGroup cannot execute simultaneously.
   * Tasks with different parallelGroup values can run in parallel.
   *
   * Ignored when exclusive is true.
   * When undefined, the task runs alone (conservative default).
   */
  parallelGroup?: string;
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
  /** Currently executing task(s). Array for parallel execution support. */
  inProgress: BaseTask[];
  completed: BaseTask[];
  isEstimating: boolean;
  dataSource: 'live' | 'session' | 'estimating';

  // Recursion tracking
  recursionCount?: number;
  recursionLimit?: number;
  /** Active worker's task name for recursion badge display (set by frontend from workflow SSE) */
  recursionTaskName?: string;

  // Token usage (job-level aggregate)
  tokenUsage?: TaskTokenUsage;

  // Estimating phase token usage (decompose + detectEnvironment, before tasks)
  estimatingTokenUsage?: TaskTokenUsage;

  // Job metadata
  jobType?: string;

  // Timing
  jobTiming?: JobTiming;

  // Interruption state
  interruption?: InterruptionDetails;

  // Node activity banner (shown when a non-task node is running)
  estimatingLabel?: string;       // Current node activity label (e.g., "환경 분석 중")
  estimatingStartedAt?: string;   // ISO timestamp when current phase started (for timer)
  estimatingNodeId?: string;      // Node ID (e.g., "decompose") for UI-specific rendering
}
