/**
 * Parallel Execution Types (Common)
 *
 * Generic type definitions for TaskOrchestrator and TaskWorker.
 * Consumed by both Code and Design parallel execution.
 *
 * Moved from code/parallel/types.ts to common/ to eliminate
 * the cross-job import (design → code).
 */

import type { BaseTask, TaskTokenUsage, TokenUsageByModel } from '@ant/shared';

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
  /** The reason for interruption (e.g. 'user_stopped', 'recursion_limit', 'consecutive_timeouts') */
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
   * Code barrier chain:
   *   foundation (200–279)        ──[feature]     ──▶ feature     (300–599)
   *   platform   (280–299)        ──[platform]    ──▶ feature     (300–599)
   *   feature    (300–599)        ──[integration] ──▶ integration (600–649)
   *   feature+integ (300–649)     ──[ui]          ──▶ ui          (670–699)
   *   feature+integ+ui (≤699)     ──[seam]        ──▶ seam        (700–749)
   *   …+seam (≤749)               ──[test-code]   ──▶ test-code   (750)
   *   …+test-code (750)           ──[doc]         ──▶ doc         (800)
   *
   * Seam (cross-feature reference + affordance closure) is its own TaskType,
   * run AFTER ui over the materialized graph (it must observe ui-introduced
   * affordances / nav). It is no longer a feature band before ui.
   *
   * Design barrier chain:
   *   tokens     (100–199) ──[assets]    ──▶ assets    (200–299)
   *   tokens+assets (100–299) ──[spec]   ──▶ spec      (300–349)
   *
   * Each flag, when true, prevents the downstream tier from starting
   * while any upstream task is still **running**. Queue order itself
   * enforces ordering when decompose places prerequisites earlier; the
   * barrier only fires once an upstream task has been dispatched (not
   * merely queued behind the consumer). This avoids circular waits when
   * decompose intentionally orders a producer task after its consumers
   * (e.g. a post-UI cleanup feature).
   */
  barriers?: {
    /** Blocks feature (300+) until all foundation (200–279) tasks complete. */
    feature?: boolean;
    /**
     * Blocks ordinary feature / integration / ui work until all platform
     * (280–299) tasks complete — shared runtime services (context/session/
     * config providers, client singletons) finish before consumers bind to
     * them, so consumers import a real access contract instead of stubbing.
     */
    platform?: boolean;
    /** Blocks integration (600–649) until all feature (<600) tasks complete. */
    integration?: boolean;
    /**
     * Blocks seam-TYPE tasks (700–749) until ALL authoring work (setup /
     * foundation / platform / feature / integration / ui) completes — the whole
     * materialized graph, INCLUDING ui-introduced affordances / navigation,
     * must exist before cross-feature reference + affordance closure. Producers
     * are every authoring bundle's `classify.producesSeamGate`. Seam sub-slices
     * (also type 'seam') do NOT produce the gate, so they never block each
     * other — no deadlock (mirrors the integration gate's producer/consumer
     * split). ui produces the gate but does NOT consume it (seam runs AFTER ui).
     */
    seam?: boolean;
    /** Blocks ui tasks until all feature/setup tasks complete (ui does NOT wait for seam — seam runs after ui). */
    ui?: boolean;
    /** Blocks test-code tasks until all feature/setup/ui/seam tasks complete (tests observe the reference-closed graph). */
    'test-code'?: boolean;
    /** Blocks doc tasks until all feature/setup/test-code/seam tasks complete. */
    doc?: boolean;
    /** Blocks assets (200+) until all tokens (100–199) tasks complete. */
    assets?: boolean;
    /** Blocks spec (300+) until all tokens+assets (100–299) tasks complete. */
    spec?: boolean;
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
    /** Per-model job-level usage — billing settle SSOT. */
    tokenUsageByModel?: TokenUsageByModel,
  ) => void;
  /** Called when a worker terminates (no more tasks to process). */
  onWorkerTerminate?: (workerId: number) => void;
  /** Called when the orchestrator is interrupted (user stop, recursion limit, consecutive timeouts). */
  onInterruption?: (reason: string, runningTaskIds: string[]) => void;
  /**
   * Read whether live credit metering has exhausted the balance. Polled at each
   * task-completion boundary; when true (and work remains) the orchestrator
   * pauses the job with `insufficient_credits` (resumable). Returns false when
   * billing is disabled / no ledger.
   */
  isCreditExhausted?: () => boolean;
}

/**
 * Checkpoint data for parallel execution state.
 */
export interface ParallelCheckpoint<T extends BaseTask> {
  /**
   * Queued tasks only. Tasks that have been actually interrupted (user stop,
   * recursion limit, Figma rate-limit, batchSplit Path A re-queue, transient
   * retry, etc.) carry their `interrupted` mark on the task object and live
   * here. The orchestrator NEVER pre-marks running tasks into this field as
   * a safety measure — see `runningTasks` below.
   */
  taskQueue: T[];
  /**
   * In-flight tasks currently assigned to workers. Carries NO defensive
   * marking. The crash-recovery boundary (`JobCleanupManager` for cloud,
   * runner.ts orphan-recovery for local CLI) is the single SSOT that
   * projects this list back onto the queue with `interrupted:true` if the
   * worker process died between save and resume.
   *
   * On graceful interruption (`handleInterruption` → `captureWorkerSnapshots`),
   * tasks here may already carry `interrupted:true` + `resumeState` from the
   * snapshot capture; the field accepts that state idempotently.
   */
  runningTasks: T[];
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
  conversations?: Record<string, Array<{ role: string; content: string | import('../../../core/ports/llm').MessageContentBlock[] }>>;
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
