/**
 * Task & Kanban Type System
 * 
 * Re-exports shared types from @ant/shared (single source of truth)
 * and defines backend-only types (Redis storage, Pub/Sub messages).
 */

import { UserContext } from './user';

// ============================================
// Shared Types (canonical source: @ant/shared)
// ============================================

export type {
  JobType,
  DecomposableJobType,
  SessionableJobType,
  JobTiming,
  TaskType,
  TaskStatus,
  TaskTiming,
  TaskTokenUsage,
  BaseTask,
  KanbanData,
} from '@ant/shared';

// Re-import for local use in this file
import type { BaseTask, TaskTokenUsage, DecomposableJobType, SessionableJobType, KanbanData } from '@ant/shared';

// ============================================
// Task Queue Snapshot (Backend-only: Redis Storage)
// ============================================

/**
 * Snapshot of the task queue stored in Redis.
 * Written by: Job Worker (KanbanBroadcaster), KanbanService
 * Read by: KanbanService, SSEService
 */
export interface TaskQueueSnapshot {
  currentTask: BaseTask | null;
  /** All currently running tasks (for parallel execution support). Falls back to [currentTask] if absent. */
  currentTasks?: BaseTask[];
  queue: BaseTask[];
  completedTasks: BaseTask[];
  recursionCount: number;
  recursionLimit: number;
  tokenUsage?: TaskTokenUsage;
  estimatingTokenUsage?: TaskTokenUsage;
  phaseTokenUsages?: import('@ant/shared').PhaseTokenUsage[];
  currentPhaseTokenUsages?: import('@ant/shared').PhaseTokenUsage[];
  jobTiming?: import('@ant/shared').JobTiming;
  // Node activity banner (for reconnect/recovery)
  estimatingLabel?: string;
  estimatingStartedAt?: string;
  estimatingNodeId?: string;
}

// ============================================
// Job-Project Mapping (Backend-only: SSE routing)
// ============================================

/**
 * Maps a jobId to its project context.
 * Used for: SSE routing, Kanban tracking, job lifecycle
 */
export interface JobProjectMapping {
  projectId: string;
  featureName: string;
  jobType: SessionableJobType;
  userContext?: UserContext;
}

// ============================================
// Kanban Broadcast Message (Backend-only: Redis Pub/Sub)
// ============================================

/**
 * Message published to Redis for Kanban updates.
 * Published by: KanbanBroadcaster (Job Worker)
 * Consumed by: SSEService (Realtime Server)
 */
export interface KanbanBroadcastMessage {
  projectId: string;
  featureName: string;
  type: 'kanban';
  data: KanbanData;
  userContext: UserContext;
}
