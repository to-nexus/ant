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
import type { JobTiming } from '@ant/shared';

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
    currentTask: BaseTask | null | undefined,
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
}
