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

export interface TaskQueueUpdatePort {
  /**
   * Update the task queue snapshot for real-time tracking
   * 
   * @param taskId - Unique identifier for the running task
   * @param currentTask - Task currently being executed (or undefined if just completed)
   * @param queue - Array of pending tasks
   * @param completedTasks - Array of completed task details
   * @param recursionCount - Current recursion iteration count (optional)
   * @param recursionLimit - Maximum recursion limit (optional)
   * @param tokenUsage - Real-time token usage for current task (optional)
   */
  updateTaskQueue(
    taskId: string,
    currentTask: any | undefined,
    queue: any[],
    completedTasks: any[],
    recursionCount?: number,
    recursionLimit?: number,
    tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number }
  ): void;
}

