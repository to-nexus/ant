/**
 * Realtime Broadcasting Types
 * 
 * Shared types for direct Redis Pub/Sub broadcasting from Job Worker.
 * These services enable real-time updates without HTTP intermediary.
 */

import { UserContext } from '../types/user';
import { REDIS_CHANNELS, REDIS_KEYS, REDIS_TTL } from '../../infrastructure/state';

// ============================================
// Re-export from central definition
// ============================================

// Channels
export const SSE_BROADCAST_CHANNEL = REDIS_CHANNELS.SSE_BROADCAST;
export const SSE_WORKFLOW_CHANNEL = REDIS_CHANNELS.SSE_WORKFLOW;

// Keys (for direct Redis access in Broadcasters)
export const TASK_QUEUE_KEY_PREFIX = REDIS_KEYS.TASK_QUEUE;
export const WORKFLOW_STATE_KEY_PREFIX = REDIS_KEYS.WORKFLOW_STATE;

// TTLs
export const TASK_QUEUE_TTL = REDIS_TTL.TASK_QUEUE;
export const WORKFLOW_STATE_TTL = REDIS_TTL.WORKFLOW_STATE;

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
  userContext?: UserContext;
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
  userContext?: UserContext;
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
  userContext?: UserContext;
}
