/**
 * Parallel Execution Types
 *
 * Type definitions for TaskOrchestrator and TaskWorker.
 * Designed to be generic over task type (CodeTask, DesignTask).
 */

import type { BaseTask, TaskTokenUsage } from '@ant/shared';

// ============================================
// Orchestrator Types
// ============================================

/**
 * Result returned by TaskOrchestrator when all tasks are done.
 */
export interface OrchestratorResult<T extends BaseTask> {
  completedTasks: T[];
  failedTasks: FailedTask<T>[];
  remainingQueue: T[];
  drainReason?: string;
  tokenUsage: TaskTokenUsage;
  /** True if any tasks permanently failed — caller should mark job as interrupted */
  hasFailures: boolean;
  /** True if any task was paused due to recursion limit, user stop, etc. (queued for resume, not failed) */
  hasInterruptedTasks: boolean;
  /** The reason for interruption (e.g. 'user_stopped', 'recursion_limit', 'consecutive_timeout') */
  interruptReason: string | null;
}

/**
 * A task that failed during execution.
 */
export interface FailedTask<T extends BaseTask> {
  task: T;
  error: Error;
  timestamp: string;
}

/**
 * Configuration for TaskOrchestrator.
 */
export interface OrchestratorConfig {
  /** Maximum concurrent workers (from ANT_TASK_CONCURRENCY, default 3) */
  maxWorkers: number;
  /** Periodic checkpoint interval in ms (default 60000) */
  checkpointInterval: number;
  /**
   * Stage-gate barriers controlling task dispatch order.
   *
   * Barrier chain:
   *   design-system (190–199) ──[designSystem]──▶ foundation (200–299)
   *   foundation    (200–299) ──[feature]      ──▶ feature   (300–649)
   *   feature       (300–649) ──[ui]           ──▶ ui        (650–699)
   *   feature       (300–649) ──[test-code]    ──▶ test-code (700)
   *   test-code     (700)     ──[doc]          ──▶ doc       (800)
   *
   * Each flag, when true, prevents the downstream tier from starting
   * while any upstream task is still running or queued.
   */
  barriers?: {
    /** Blocks foundation (200+) until all design-system (190–199) tasks complete. */
    designSystem?: boolean;
    /** Blocks feature (300+) until all foundation (200–299) tasks complete. */
    feature?: boolean;
    /** Blocks ui tasks until all feature/setup tasks complete. */
    ui?: boolean;
    /** Blocks test-code tasks until all feature/setup tasks complete. */
    'test-code'?: boolean;
    /** Blocks doc tasks until all feature/setup/test-code tasks complete. */
    doc?: boolean;
  };
}

/**
 * Callback interface for Orchestrator to communicate with the main graph.
 */
export interface OrchestratorCallbacks<T extends BaseTask> {
  /** Called when a task completes successfully */
  onTaskComplete?: (task: T, workerId: number) => void;
  /** Called when a task fails */
  onTaskFailure?: (task: T, error: Error, workerId: number) => void;
  /** Called to save a checkpoint */
  onCheckpoint?: (checkpoint: ParallelCheckpoint<T>) => Promise<void>;
  /** Called to broadcast kanban updates */
  onKanbanUpdate?: (
    currentTasks: T[],
    queue: T[],
    completedTasks: T[],
    tokenUsage?: TaskTokenUsage,
  ) => void;
  /** Called when a worker terminates (no more tasks to process).
   *  Used to immediately clear the worker's stale entry from WorkflowBroadcaster
   *  so its last-active-node badge disappears from the UI without waiting for
   *  all parallel workers to finish. */
  onWorkerTerminate?: (workerId: number) => void;
}

/**
 * Checkpoint data for parallel execution state.
 */
export interface ParallelCheckpoint<T extends BaseTask> {
  taskQueue: T[];
  completedTasks: T[];
  failedTasks: FailedTask<T>[];
  tokenUsage: TaskTokenUsage;
  parallelMode: true;
  interruption?: {
    reason: string;
    canResume: boolean;
  };
}

// ============================================
// Worker Types
// ============================================

/**
 * Function signature for building a worker subgraph.
 * The orchestrator injects this to decouple graph construction.
 */
export type WorkerGraphBuilder = (includeInstallValidate: boolean) => {
  invoke: (state: any, config?: any) => Promise<any>;
};

/**
 * State snapshot captured from a worker during interruption.
 */
export interface WorkerSnapshot {
  planText?: string;
  conversationHistory?: any[];
  projectCodeContext?: {
    source: string;
    filePaths: string[];
    stats: any;
  };
  retries?: number;
  violations?: any[];
  enforcementHistory?: any[];
  tokenUsage?: TaskTokenUsage;
}

// ============================================
// Concurrency Configuration
// ============================================

/**
 * Get the maximum task concurrency from environment.
 * Defaults to 3. Set to 1 for sequential (backward-compatible) behavior.
 */
export function getTaskConcurrency(): number {
  const envValue = process.env.ANT_TASK_CONCURRENCY;
  if (!envValue) return 3;
  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed) || parsed < 1) return 3;
  return parsed;
}
