/**
 * Kanban Update Port
 * 
 * Defines the contract for real-time task queue updates.
 * This allows the core domain to notify external systems (UI, monitoring)
 * about task state changes without depending on specific implementations.
 * 
 * Hexagonal Architecture:
 * - Core (agents/graph) depends on this PORT (interface)
 * - Periphery (ExpressServerAdapter) IMPLEMENTS this interface
 * - Orchestrator INJECTS the implementation via deps
 */

import { BaseTask, TaskTokenUsage } from '../types/task';
import type { JobTiming, PhaseTokenUsage } from '@ant/shared';

export interface TaskQueueUpdatePort {
  /**
   * Update the task queue snapshot for real-time tracking
   * 
   * @param taskId - Unique identifier for the running task
   * @param currentTask - Task currently being executed (or null if just completed)
   * @param queue - Array of pending tasks
   * @param completedTasks - Array of completed task details
   * @param recursionCount - Current recursion iteration count
   * @param recursionLimit - Maximum recursion limit
   * @param tokenUsage - Real-time token usage for current task
   */
  updateTaskQueue(
    taskId: string,
    currentTask: BaseTask | BaseTask[] | null | undefined,
    queue: BaseTask[],
    completedTasks: BaseTask[],
    recursionCount?: number,
    recursionLimit?: number,
    tokenUsage?: TaskTokenUsage
  ): void;

  /**
   * Set job-level timing data for inclusion in all subsequent broadcasts.
   * Called once when jobTiming is initialized (resolve/decompose nodes),
   * so every SSE broadcast includes timing without per-call overhead.
   */
  setJobTiming?(jobTiming: JobTiming): void;

  /**
   * Set the current non-task node activity label for the Kanban board banner.
   * Broadcasts immediately. Auto-cleared when updateTaskQueue receives tasks.
   * @param label - User-facing label (e.g., "환경 분석 중")
   * @param nodeId - Graph node ID (e.g., "decompose") for UI-specific rendering
   */
  setEstimatingActivity?(label: string, nodeId?: string): void;

  /**
   * Clear the estimating activity label and broadcast the cleared state.
   * Call when the graph terminates without producing tasks (e.g., triage → ask/redirect/blocked → __end__).
   */
  clearEstimatingActivity?(): void;

  /**
   * Update job-level token usage and re-broadcast if in estimating mode.
   * Called after accumulateTokenUsage() during the estimating phase
   * (triage, detect, decompose) so the frontend badge updates in real-time.
   */
  updateTokenUsage?(tokenUsage: TaskTokenUsage): void;

  /**
   * Snapshot estimating phase token usage (detect + decompose, before tasks).
   * Called once at end of decompose, included in all subsequent broadcasts
   * so the frontend can show estimating vs task breakdown without subtraction.
   */
  setEstimatingTokenUsage?(tokenUsage: TaskTokenUsage): void;

  /**
   * Update per-phase token breakdown for non-task-queue jobs (visual/plan).
   * Each entry represents a distinct graph node's cumulative token usage.
   */
  updatePhaseTokenUsages?(phases: PhaseTokenUsage[]): void;

  /**
   * Upsert the latest-LLM-call snapshot for the graph node currently running
   * on the given worker. `snapshot.workerId` selects the slot — undefined =
   * main/sequential; every integer workerId gets its own slot so parallel
   * workers each produce their own battery on the chat-input gauge.
   *
   * Unlike `updatePhaseTokenUsages` (cumulative history per node), this is a
   * single snapshot overwritten on each LLM call. Idle FE retains last value
   * via the kanban reducer's "undefined = preserve" rule.
   */
  updateCurrentPhaseTokenUsage?(snapshot: PhaseTokenUsage): void;

  /**
   * Drop the per-worker phase snapshot when a parallel worker terminates.
   * Called from `TaskOrchestrator.onWorkerTerminate` so stale worker
   * batteries disappear from the chat-input gauge immediately.
   */
  clearWorkerPhaseTokenUsage?(workerId: number): void;

  /**
   * Update a single in-progress task's token usage and re-broadcast.
   * Designed for parallel workers that only know their own task's tokens.
   * Uses the broadcaster's cached task lists from the last updateTaskQueue call.
   */
  updateInProgressTaskTokenUsage?(taskId: string, taskTokenUsage: TaskTokenUsage): void;

  /**
   * Save a checkpoint snapshot to Redis for disaster recovery.
   * Unlike updateTaskQueue, this does NOT broadcast via Pub/Sub — it only
   * persists the snapshot to Redis so that cleanupJobState can use it as
   * a fallback when the session file is unreadable.
   * 
   * Called from the parallel orchestrator's onCheckpoint callback.
   * 
   * @param queue - Task queue including running tasks (marked interrupted)
   * @param completedTasks - Array of completed task objects
   * @param tokenUsage - Accumulated token usage
   */
  saveCheckpointSnapshot?(
    queue: BaseTask[],
    completedTasks: BaseTask[],
    tokenUsage?: TaskTokenUsage
  ): void;
}
