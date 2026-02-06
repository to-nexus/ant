/**
 * Workflow Types
 * 
 * Real-time workflow state sent via SSE from BE to FE.
 * Used for workflow visualization (node transitions, history).
 */

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

/** Real-time workflow state (sent via SSE) */
export interface WorkflowRealtimeState {
  jobId: string;
  currentNode: string | null;
  previousNode: string | null;
  currentTask: TaskInfo | null;
  startedAt: string;
  endedAt?: string;
  isCompleted: boolean;
  nodeHistory: NodeHistoryEntry[];
  activeActors: string[];

  // Kanban info (piggybacked on workflow SSE for atomic updates)
  kanbanCurrentTask?: TaskInfo | null;
  kanbanUpdate?: boolean;
}
