/**
 * Workflow Types
 * 
 * Real-time workflow state sent via SSE from BE to FE.
 * Used for workflow visualization (node transitions, history).
 */

/** LLM provider/model info for real-time workflow display */
export interface LLMInfo {
  provider: string;
  model: string;
}

/** Task info piggybacked on workflow SSE */
export interface TaskInfo {
  id?: string;
  name: string;
  type?: string;
  description?: string;
  priority?: number;
}

/** Node transition history entry */
export interface NodeHistoryEntry {
  nodeId: string;
  enteredAt: string;
  exitedAt?: string;
  duration?: number;
}

/** Active worker node — represents one worker occupying a graph node */
export interface ActiveWorkerNode {
  workerId: number;
  nodeId: string;              // Original graph node ID (plan, execute, etc.)
  previousNodeId: string | null;  // Previous node (for edge animation)
  taskName: string;            // Display task name
  taskId: string;              // Task ID
  enteredAt: string;           // ISO timestamp when entered
}

/** Real-time workflow state (sent via SSE) */
export interface WorkflowRealtimeState {
  jobId: string;
  startedAt: string;
  endedAt?: string;
  isCompleted: boolean;

  /** All currently active worker nodes. */
  activeNodes: ActiveWorkerNode[];

  nodeHistory: NodeHistoryEntry[];
  activeActors: string[];

  // Kanban info (piggybacked on workflow SSE for atomic updates)
  kanbanCurrentTask?: TaskInfo | null;
  kanbanUpdate?: boolean;

  // Recursion tracking (piggybacked on workflow SSE for real-time display)
  recursionCount?: number;
  recursionLimit?: number;

  // LLM model info (updated on each node entry that uses LLM)
  llmInfo?: LLMInfo | null;
}
