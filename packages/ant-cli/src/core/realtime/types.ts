/**
 * Realtime Broadcasting Types
 * 
 * Central type definitions for all real-time communication:
 * - SSE transport types (message routing, client management)
 * - Redis Pub/Sub broadcast message types
 * - Broadcaster configuration
 * 
 * Used by:
 *   - SSEService (Realtime Server)
 *   - KanbanBroadcaster, WorkflowBroadcaster, FileTreeBroadcaster (Job Worker)
 *   - Frontend SSEManager (mirrors SSEMessageType)
 */

import { UserContext } from '../types/user';
import { 
  REDIS_KEYS, 
  REDIS_TTL,
  getRealtimeBroadcastChannel,
  getRealtimeWorkflowChannel
} from '../../infrastructure/state';
import type { 
  TaskQueueSnapshot, 
  KanbanBroadcastMessage, 
  KanbanData,
  JobProjectMapping,
  DecomposableJobType 
} from '../types/task';

// ============================================
// Re-export from central definitions
// ============================================

// Task types (from core/types/task.ts)
export type { TaskQueueSnapshot, KanbanBroadcastMessage, KanbanData, JobProjectMapping, DecomposableJobType };

// Channel generation functions (user-scoped)
export { getRealtimeBroadcastChannel, getRealtimeWorkflowChannel };

// Keys (for direct Redis access in Broadcasters)
export const TASK_QUEUE_KEY_PREFIX = REDIS_KEYS.JOB.TASK_QUEUE;
export const TASK_QUEUE_CHECKPOINT_KEY_PREFIX = REDIS_KEYS.JOB.TASK_QUEUE_CHECKPOINT;
export const WORKFLOW_STATE_KEY_PREFIX = REDIS_KEYS.JOB.WORKFLOW;

// TTLs
export const TASK_QUEUE_TTL = REDIS_TTL.JOB.TASK_QUEUE;
export const WORKFLOW_STATE_TTL = REDIS_TTL.JOB.WORKFLOW;

// ============================================
// SSE Transport Types
// ============================================

/** Message types routed through the unified SSE stream */
export type SSEMessageType = 'kanban' | 'chat' | 'fileTree' | 'workflow' | 'preview' | 'gitChange' | 'unseenArtifacts' | 'bridge';

/** SSE message envelope sent to frontend */
export interface SSEMessage {
  type: SSEMessageType;
  timestamp: string;
  data: any;
}

/** Broadcast message published to Redis for SSE routing.
 * projectId/featureName are optional for user-level messages (e.g., bridge status)
 * that should be delivered to all SSE clients of a user regardless of project context. */
export interface SSEBroadcastMessage {
  projectId?: string;
  featureName?: string;
  type: SSEMessageType;
  data: any;
  userContext: UserContext;
}

/** Workflow-specific SSE message (separate channel) */
export interface SSEWorkflowMessage {
  jobId: string;
  data: any;
  isEndEvent?: boolean;
  userContext: UserContext;
}

// ============================================
// Workflow Types (canonical source: core/ports/stateStore.ts)
// ============================================

export type { WorkflowRealtimeState, NodeHistoryEntry } from '../ports/stateStore';

import type { WorkflowRealtimeState } from '../ports/stateStore';

export interface WorkflowBroadcastMessage {
  jobId: string;
  data: WorkflowRealtimeState;
  isEndEvent: boolean;
  userContext: UserContext;
}

// ============================================
// FileTree Types
// ============================================

export interface FileTreeBroadcastMessage {
  projectId: string;
  featureName: string;
  type: 'fileTree';
  data: {
    type: 'update';
    tree: any;
  };
  userContext: UserContext;
}

// ============================================
// Broadcaster Options
// ============================================

export interface BroadcasterOptions {
  redisUrl: string;
  jobId: string;
  projectId: string;
  featureName: string;
  jobType?: string;
  userContext: UserContext;
}
