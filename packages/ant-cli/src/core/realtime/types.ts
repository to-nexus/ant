/**
 * Realtime Broadcasting Types
 * 
 * Shared types for direct Redis Pub/Sub broadcasting from Job Worker.
 * These services enable real-time updates without HTTP intermediary.
 */

import { UserContext } from '../types/user';
import { 
  REDIS_KEYS, 
  REDIS_TTL,
  getSSEBroadcastChannel,
  getSSEWorkflowChannel
} from '../../infrastructure/state';

// ============================================
// Re-export from central definition
// ============================================

// Channel generation functions (user-scoped)
export { getSSEBroadcastChannel, getSSEWorkflowChannel };

// Keys (for direct Redis access in Broadcasters)
export const TASK_QUEUE_KEY_PREFIX = REDIS_KEYS.JOB.TASK_QUEUE;
export const WORKFLOW_STATE_KEY_PREFIX = REDIS_KEYS.JOB.WORKFLOW;

// TTLs
export const TASK_QUEUE_TTL = REDIS_TTL.JOB.TASK_QUEUE;
export const WORKFLOW_STATE_TTL = REDIS_TTL.JOB.WORKFLOW;

// ============================================
// Kanban Types
// ============================================

export interface TaskQueueSnapshot {
  currentTask?: any;
  queue: any[];
  completedTasks: any[];
  recursionCount?: number;
  recursionLimit?: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

export interface KanbanBroadcastMessage {
  projectId: string;
  featureName: string;
  type: 'kanban';
  data: any;  // Full Kanban data with queue/current/completed
  userContext: UserContext;  // Required for user-scoped channels
}

// ============================================
// Workflow Types
// ============================================

export interface WorkflowState {
  jobId: string;
  currentNode?: string;
  nodeHistory: string[];
  activeActors: string[];
  startTime: number;
  lastUpdate: number;
  taskInfo?: {
    id?: string;
    name: string;
    type?: string;
    description?: string;
    priority?: number;
  };
  llmInfo?: {
    provider: string;
    model: string;
  };
  recursionCount?: number;
  recursionLimit?: number;
}

export interface WorkflowBroadcastMessage {
  jobId: string;
  data: WorkflowState;
  isEndEvent: boolean;
  userContext: UserContext;  // Required for user-scoped channels
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
    tree: any;  // File tree structure
  };
  userContext: UserContext;  // Required for user-scoped channels
}

// ============================================
// Job Mapping Types (for context lookup)
// ============================================

export interface JobMapping {
  projectId: string;
  featureName: string;
  jobType?: 'design' | 'code' | 'learn';
  userContext?: UserContext;
}

// ============================================
// Broadcaster Options
// ============================================

export interface BroadcasterOptions {
  redisUrl: string;
  jobId: string;
  projectId: string;
  featureName: string;
  jobType?: 'design' | 'code' | 'learn';
  userContext: UserContext;  // Required for user-scoped channels
}
