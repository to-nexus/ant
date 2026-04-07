/**
 * StateStorePort
 * 
 * Unified interface for state storage in ant-cli.
 * Combines Job State, Port Registry, and Pub/Sub capabilities.
 * 
 * Implementations:
 * - InMemoryStateStore: For local/single-server mode
 * - RedisStateStore: For cloud/distributed mode (Phase 2)
 * 
 * @see 10-cloud-scalability-design.md Section 4.1
 */

import { UserContext } from '../types/user';
import { TaskQueueSnapshot, JobProjectMapping } from '../types/task';
import type { JobType } from '@ant/shared';

// Re-export for consumers
export type { TaskQueueSnapshot, JobProjectMapping };

// Re-export LogEntry from http.ts to avoid duplication
export { LogEntry } from './http';
import { LogEntry } from './http';

// ============================================
// Job Status Types
// ============================================

export type JobStatusValue = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'paused';

export interface JobStatusData {
  jobId: string;
  status: JobStatusValue;
  projectId: string;
  featureName: string;
  type: JobType;
  mode?: 'generate' | 'refactor' | 'explain';
  timestamp?: string;
  userContext?: UserContext;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  task?: string;
}

// ============================================
// Workflow State Types (for Cross-Pod Workflow Tracking)
// ============================================

// Shared types (canonical source: @ant/shared)
export type { TaskInfo, NodeHistoryEntry, LLMInfo } from '@ant/shared';

import type { LLMInfo } from '@ant/shared';
import type { WorkflowRealtimeState as SharedWorkflowRealtimeState } from '@ant/shared';

/**
 * Backend-extended WorkflowRealtimeState (stored in Redis).
 * Narrows llmInfo from optional to required (always present in BE, null before first LLM call).
 * llmInfo is included in SSE payload for FE workflow visualization.
 */
export interface WorkflowRealtimeState extends SharedWorkflowRealtimeState {
  llmInfo: LLMInfo | null;
}

// ============================================
// Chat Session Types (for Cloud Mode)
// ============================================

export interface ChatMessageContent {
  type: string;
  content: string;
  metadata?: Record<string, any>;
}

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  contents: ChatMessageContent[];
  timestamp: string;
  jobId?: string;
  isStreaming?: boolean;
}

export interface ChatSessionData {
  projectId: string;
  featureName: string;
  jobId?: string;
  messages: ChatMessageData[];
  userContext?: UserContext;
  // Streaming state
  thinkingStartTime?: number;
  lastThinkingContentIndex?: number;
  activeFileOperations?: Array<{ filePath: string; contentIndex: number }>;
}

// ============================================
// Pending Choice Types (for Cloud Mode)
// ============================================

/**
 * Triage result stored in Redis for pending choices
 * Simplified version for Redis storage
 * Mirrors TriageResult from agents/common/nodes/triage/types.ts
 */
export interface PendingChoiceTriageResult {
  intent: string;
  inScope?: boolean;
  workStatus?: 'proceed' | 'blocked' | 'redirect';
  suggestedAgent?: string;
  suggestedJob?: string;
  redirectReason?: string;
  missingPrerequisites?: {
    required?: string[];
    recommended?: string[];
  };
  canProceed?: boolean;
  blockedMessage?: string;
  displayMessage?: string;
  needsChoice?: boolean;
  choiceOptions?: {
    positive?: { label: string; action: string };
    negative?: { label: string; action: string };
    neutral?: { label: string; action: string };
    fallbackGuide?: string;
  };
}

/**
 * Pending Choice Data for Redis storage
 */
export interface PendingChoiceData {
  jobId: string;
  projectId: string;
  featureName: string;
  triageResult: PendingChoiceTriageResult;
  originalDirective?: string;
  createdAt: number;
  expiresAt: number;
}

// ============================================
// Port Registry Types (re-exported from portRegistry.ts)
// ============================================

// Re-export from portRegistry
export { PortMapping, PreviewState, IDEState, PreviewPackage, PreviewRuntimeIssue, PreviewPhase, ServiceCategory, ConnectionResolution, ServiceConnection, DeployState, DeployPhase, DeployFramework } from './portRegistry';
import { PreviewState, IDEState, PortMapping, ServiceConnection, DeployState } from './portRegistry';
import type { PreviewStructureType } from './preview';

// ============================================
// StateStorePort Interface
// ============================================

export interface StateStorePort {
  // ============================================
  // Job Status Management
  // ============================================
  
  /**
   * Set job status
   */
  setJobStatus(jobId: string, status: JobStatusData): Promise<void>;
  
  /**
   * Get job status
   */
  getJobStatus(jobId: string): Promise<JobStatusData | null>;
  
  /**
   * Update partial job status
   */
  updateJobStatus(jobId: string, updates: Partial<JobStatusData>): Promise<void>;
  
  /**
   * Delete job status
   */
  deleteJobStatus(jobId: string): Promise<void>;
  
  /**
   * List jobs by project and feature
   */
  listJobsByFeature(projectId: string, featureName: string): Promise<JobStatusData[]>;
  
  // ============================================
  // Job Logs Management
  // ============================================
  
  /**
   * Append log entry to job
   */
  appendJobLog(jobId: string, log: LogEntry): Promise<void>;
  
  /**
   * Get all logs for a job
   */
  getJobLogs(jobId: string): Promise<LogEntry[]>;
  
  /**
   * Clear logs for a job
   */
  clearJobLogs(jobId: string): Promise<void>;
  
  // ============================================
  // Task Queue Snapshot Management
  // ============================================
  
  /**
   * Update task queue snapshot
   */
  updateTaskQueue(jobId: string, snapshot: TaskQueueSnapshot): Promise<void>;
  
  /**
   * Get task queue snapshot (live, from broadcasts)
   */
  getTaskQueue(jobId: string): Promise<TaskQueueSnapshot | null>;
  
  /**
   * Get task queue checkpoint snapshot (disaster recovery fallback).
   * Falls back to live snapshot if checkpoint doesn't exist.
   */
  getTaskQueueCheckpoint(jobId: string): Promise<TaskQueueSnapshot | null>;
  
  /**
   * Delete task queue snapshot (both live and checkpoint)
   */
  deleteTaskQueue(jobId: string): Promise<void>;

  // ============================================
  // Workflow State Management (Cross-Pod)
  // ============================================
  
  /**
   * Set workflow state (saves to Redis AND publishes via Pub/Sub)
   */
  setWorkflowState(jobId: string, state: WorkflowRealtimeState): Promise<void>;
  
  /**
   * Set workflow state silently (saves to Redis WITHOUT Pub/Sub publish).
   * Used by cleanup/finalization where an explicit end event is sent separately.
   */
  setWorkflowStateSilent(jobId: string, state: WorkflowRealtimeState): Promise<void>;
  
  /**
   * Get workflow state
   */
  getWorkflowState(jobId: string): Promise<WorkflowRealtimeState | null>;
  
  /**
   * Delete workflow state
   */
  deleteWorkflowState(jobId: string): Promise<void>;

  // ============================================
  // Job-Project Mapping
  // ============================================
  
  /**
   * Set job-project mapping
   */
  setJobMapping(jobId: string, mapping: JobProjectMapping): Promise<void>;
  
  /**
   * Get job-project mapping
   */
  getJobMapping(jobId: string): Promise<JobProjectMapping | null>;
  
  /**
   * Delete job-project mapping
   */
  deleteJobMapping(jobId: string): Promise<void>;
  
  // ============================================
  // User-Stopped Jobs Tracking
  // ============================================
  
  /**
   * Mark job as user-stopped
   */
  markUserStopped(jobId: string): Promise<void>;
  
  /**
   * Check if job was user-stopped
   */
  isUserStopped(jobId: string): Promise<boolean>;
  
  /**
   * Clear user-stopped flag
   */
  clearUserStopped(jobId: string): Promise<void>;
  
  // ============================================
  // Port Registry - Preview (Full State Management)
  // ============================================
  
  /**
   * Register/Update preview state
   */
  registerPreview(state: Omit<PreviewState, 'lastAccessedAt'>): Promise<void>;
  
  /**
   * Get preview state
   */
  getPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<PreviewState | null>;
  
  /**
   * Update preview state (partial)
   */
  updatePreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    update: Partial<Pick<PreviewState, 'running' | 'ready' | 'phase' | 'error' | 'issues' | 'packages' | 'backendPort' | 'nativeBasePath' | 'structureType' | 'setupReasoning' | 'setupReason' | 'suggestedFix' | 'connections'>>
  ): Promise<void>;
  
  /**
   * Update last accessed time
   */
  touchPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void>;
  
  /**
   * Save preview config (user settings: connections, structureType, projectProfile).
   * Stored separately from runtime state — persists across preview start/stop.
   */
  savePreviewConfig(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    config: { connections?: ServiceConnection[] | null; structureType?: PreviewStructureType | null; projectProfile?: { language: string; framework?: string } | null }
  ): Promise<void>;
  
  /**
   * Get preview config (user settings).
   * Returns null if no config has been saved.
   */
  getPreviewConfig(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<{ connections?: ServiceConnection[] | null; structureType?: PreviewStructureType | null; projectProfile?: { language: string; framework?: string } | null } | null>;
  
  /**
   * Unregister preview
   */
  unregisterPreview(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void>;
  
  /**
   * List all active previews
   */
  listPreviews(): Promise<PreviewState[]>;
  
  /**
   * List previews by pod
   */
  listPreviewsByPod(podId: string): Promise<PreviewState[]>;
  
  /**
   * Get idle previews
   */
  getIdlePreviews(idleThresholdMs: number): Promise<PreviewState[]>;
  
  // ============================================
  // Port Registry - Deploy (Static Build Serving)
  // ============================================

  /**
   * Register deploy state
   */
  registerDeploy(state: Omit<DeployState, 'lastAccessedAt'>): Promise<void>;

  /**
   * Get deploy state
   */
  getDeploy(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<DeployState | null>;

  /**
   * Update deploy state (partial)
   */
  updateDeploy(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    update: Partial<Pick<DeployState, 'phase' | 'port' | 'error' | 'buildLog' | 'url'>>
  ): Promise<void>;

  /**
   * Unregister deploy
   */
  unregisterDeploy(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<void>;

  /**
   * List all active deploys
   */
  listDeploys(): Promise<DeployState[]>;

  // ============================================
  // Port Registry - IDE (Full State Management)
  // ============================================
  
  /**
   * Register IDE state
   */
  registerIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    port: number,
    host: string,
    podId: string,
    feature?: string
  ): Promise<void>;
  
  /**
   * Get IDE state
   */
  getIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature?: string
  ): Promise<IDEState | null>;
  
  /**
   * Update last accessed time
   */
  touchIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature?: string
  ): Promise<void>;
  
  /**
   * Unregister IDE
   */
  unregisterIDE(
    tenantId: string,
    userId: string,
    projectId: string,
    feature?: string
  ): Promise<void>;
  
  /**
   * List all active IDEs
   */
  listIDEs(): Promise<IDEState[]>;
  
  // ============================================
  // Chat Session Management (for Cloud Mode)
  // ============================================
  
  /**
   * Get chat session
   * @param sessionKey - Format: "org:user:projectId/featureName"
   */
  getChatSession(sessionKey: string): Promise<ChatSessionData | null>;
  
  /**
   * Set chat session
   */
  setChatSession(sessionKey: string, session: ChatSessionData): Promise<void>;
  
  /**
   * Delete chat session
   */
  deleteChatSession(sessionKey: string): Promise<void>;
  
  /**
   * Get current streaming message for a session
   */
  getCurrentMessage(sessionKey: string): Promise<ChatMessageData | null>;
  
  /**
   * Set current streaming message for a session
   */
  setCurrentMessage(sessionKey: string, message: ChatMessageData | null): Promise<void>;
  
  /**
   * Check if session has active (streaming) message
   */
  hasActiveMessage(sessionKey: string): Promise<boolean>;
  
  // ============================================
  // Pending Choice Management (for Cloud Mode)
  // ============================================
  
  /**
   * Set pending choice
   * @param choiceKey - Format: "projectId:featureName"
   */
  setPendingChoice(choiceKey: string, choice: PendingChoiceData): Promise<void>;
  
  /**
   * Get pending choice
   */
  getPendingChoice(choiceKey: string): Promise<PendingChoiceData | null>;
  
  /**
   * Delete pending choice
   */
  deletePendingChoice(choiceKey: string): Promise<void>;
  
  // ============================================
  // Unseen Artifacts Management
  // ============================================

  /**
   * Add unseen artifact paths for a user/project/feature.
   * Used when jobs generate output files (plan, design, eval).
   */
  addUnseenArtifacts(userId: string, projectId: string, feature: string, paths: string[]): Promise<void>;

  /**
   * Remove unseen artifact paths (mark as seen).
   * Called when user views files in the ArtifactsPanel.
   */
  removeUnseenArtifacts(userId: string, projectId: string, feature: string, paths: string[]): Promise<void>;

  /**
   * Get all unseen artifact paths for a user/project/feature.
   */
  getUnseenArtifacts(userId: string, projectId: string, feature: string): Promise<string[]>;

  /**
   * Clear all unseen artifacts for a user/project/feature.
   */
  clearUnseenArtifacts(userId: string, projectId: string, feature: string): Promise<void>;

  // ============================================
  // FileTree Cache (cross-pod consistency via Redis)
  // ============================================

  /**
   * Cache file tree snapshot in Redis.
   * Called by FileTreeBroadcaster (Worker) and WorkflowBridge (API server)
   * after building the tree from filesystem.
   */
  setFileTreeCache(userId: string, projectId: string, feature: string, tree: any[]): Promise<void>;

  /**
   * Get cached file tree from Redis.
   * Used by Realtime server for SSE initial state instead of reading EFS directly,
   * bypassing NFS attribute caching issues in multi-pod environments.
   */
  getFileTreeCache(userId: string, projectId: string, feature: string): Promise<any[] | null>;

  // ============================================
  // Job Recovery (Crash Recovery)
  // ============================================

  /**
   * Find all jobs with a given status (e.g. 'running') by scanning Redis keys.
   * Used on startup to detect orphaned jobs from a previous crash.
   */
  findJobsByStatus(status: JobStatusValue): Promise<JobStatusData[]>;

  // ============================================
  // Pub/Sub (for Cloud Mode real-time updates)
  // ============================================
  
  /**
   * Publish message to channel
   */
  publish(channel: string, message: any): Promise<void>;
  
  /**
   * Subscribe to channel
   * @returns Unsubscribe function
   */
  subscribe(channel: string, callback: (message: any) => void): Promise<() => void>;
  
  // ============================================
  // Generic Key-Value Operations
  // ============================================
  
  /**
   * Set a key with TTL (for OIDC state, SSE connection counts, etc.)
   */
  setKeyWithTTL(key: string, value: string, ttlSeconds: number): Promise<void>;
  
  /**
   * Get a key value
   */
  getKey(key: string): Promise<string | null>;
  
  /**
   * Delete a key
   */
  deleteKey(key: string): Promise<void>;
  
  /**
   * Increment a key and return the new value. Creates the key if it doesn't exist.
   */
  incrementKey(key: string): Promise<number>;
  
  /**
   * Decrement a key and return the new value. Creates the key if it doesn't exist.
   */
  decrementKey(key: string): Promise<number>;
  
  /**
   * Set TTL on an existing key.
   */
  expireKey(key: string, ttlSeconds: number): Promise<void>;
  
  // ============================================
  // Distributed Locking
  // ============================================
  
  /**
   * Atomic set-if-not-exists with TTL. Returns true if acquired.
   */
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;
  
  /**
   * Release a previously acquired lock.
   */
  releaseLock(key: string): Promise<void>;
  
  // ============================================
  // Lifecycle
  // ============================================
  
  /**
   * Close connections and cleanup resources
   */
  close(): Promise<void>;
  
  /**
   * Clear all data (for testing)
   */
  clear(): Promise<void>;
}
