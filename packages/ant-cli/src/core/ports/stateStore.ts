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
// Chat Turn Buffer (in-flight streaming scratchpad)
// ============================================

import type { PendingCardSnapshot, TurnBufferSnapshot } from '@ant/shared';

/** Payload stored in Redis CHAT.TURN_BUFFER — finalize/clear removes it. */
export interface TurnBufferData {
  text?: string;
  thinking?: string;
  pendingCards?: Record<string, PendingCardSnapshot>;
}

// Re-export for downstream consumers.
export type { PendingCardSnapshot, TurnBufferSnapshot };

// ============================================
// Pending Choice Types (for Cloud Mode)
// ============================================

/**
 * Triage result stored in Redis for pending choices
 * Simplified version for Redis storage
 * Mirrors TriageResult from agents/common/graph/nodes/triage/types.ts
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
export { PortMapping, PreviewState, IDEState, PreviewPackage, PreviewRuntimeIssue, PreviewPhase, ServiceCategory, ConnectionResolution, ServiceConnection, DeployState, DeployPackage, DeployPhase, DeployFramework } from './portRegistry';
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
  // Kill Reason (pre-SIGTERM hint)
  // ============================================

  /**
   * Delete the pre-SIGTERM kill reason key (`ant:job:killReason:{jobId}`).
   * Called by the terminal-seal pipeline to guarantee no residual keys remain
   * after a job finalizes. Kill reason has a 60s TTL so this is primarily a
   * belt-and-suspenders guarantee.
   */
  deleteKillReason(jobId: string): Promise<void>;

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
    update: Partial<Pick<DeployState, 'phase' | 'host' | 'podId' | 'error' | 'buildLog' | 'workspacePath' | 'packages' | 'lastAccessedAt'>>
  ): Promise<void>;

  /**
   * Refresh deploy lastAccessedAt + TTL (sliding TTL).
   * No-op if the deploy does not exist.
   * Called by the proxy on every successful fetch.
   */
  touchDeploy(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
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
  // Chat Turn Buffer (in-flight streaming)
  // ============================================
  //
  // The chat.jsonl log owns every finalized chat event. The TURN_BUFFER
  // owns the in-flight streaming state (text / thinking / per-card
  // streamedOutput). Both never hold the same data simultaneously —
  // the worker clears the buffer the moment it appends the finalized
  // ChatLine.

  /** Full buffer snapshot for `(sessionKey, turnId, workerScope?)`. */
  getTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope?: string,
  ): Promise<TurnBufferData | null>;

  /**
   * Append streaming chunk to the turn buffer. `kind='card_output'`
   * requires `cardId` and appends to `pendingCards[cardId].streamedOutput`;
   * `text` / `thinking` append to the root scalar fields.
   * The key TTL is refreshed on every write.
   */
  appendToTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    kind: 'text' | 'thinking' | 'card_output',
    chunk: string,
    cardId?: string,
  ): Promise<void>;

  /**
   * Register an in-flight card (typically called when a command / file /
   * long-running card starts, before the first stdout chunk arrives).
   */
  setTurnBufferPendingCard(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    card: PendingCardSnapshot,
  ): Promise<void>;

  /** Remove a single pendingCards entry (called on card finalize). */
  clearTurnBufferPendingCard(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    cardId: string,
  ): Promise<void>;

  /**
   * Clear a single turn buffer entry. Called when the matching
   * ChatLine (assistant_message / assistant_thinking / chat_status
   * finalize) is appended to chat.jsonl.
   */
  clearTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope?: string,
  ): Promise<void>;

  /**
   * Remove every turn-buffer entry for a session. Called by hard reset
   * / chat clear paths.
   */
  clearAllTurnBuffersForFeature(sessionKey: string): Promise<void>;

  /** List every active `(turnId, workerScope)` buffer for a session. */
  listActiveTurnBuffers(sessionKey: string): Promise<TurnBufferSnapshot[]>;

  /**
   * Return a monotonically increasing pause sequence for a turn.
   * Used by `ChatService.appendChoicePresentedCancelled` to mint
   * deterministic `cancelled-{turnId}-{jobId}-{seq}` cardIds so
   * repeated pause/resume cycles cannot collide.
   *
   * SCOPE: cancelled cardId uniqueness ONLY. The worker scope
   * `cycleSeq` suffix (`worker-N#task-K#p{n}`) is owned by
   * `nextWorkerCycleSeq` / `getCurrentWorkerCycleSeq` — different key
   * partition (turnId × taskKey) and different INCR triggers
   * (Stop only here vs. all task re-entries there).
   */
  nextPauseSeq(turnId: string): Promise<number>;

  /**
   * Peek (GET-only, no INCR) the current pause sequence for a turn.
   * Returns 0 when the key is absent / unset (no cancellation has
   * occurred for this turn yet). Currently retained for diagnostics
   * and the legacy `LLMResponseService.getCurrentPauseSeq` shim —
   * `TaskWorker` no longer consumes this for cycleSeq composition
   * (see `getCurrentWorkerCycleSeq`).
   */
  getCurrentPauseSeq(turnId: string): Promise<number>;

  /**
   * INCR + return the per-(turn, task) worker cycle sequence used as
   * the `worker-N#task-K#p{cycleSeq}` chat scope suffix. Called by
   * `TaskWorker.executeTask` whenever it picks up a task that bears a
   * re-entry marker so each re-entry mints an isolated FE chat
   * section AND an isolated `LLMResponseService.WorkerLocalState`
   * slot (the latter is what fixes stale `fileCardByPath` /
   * `commandCardByCommand` / `thinking` carry-over across batchSplit
   * Path A re-queues / orchestrator transient retry / Stop+Resume).
   *
   * Returns the new value (>=1). The first re-entry returns 1, the
   * next 2, etc. Fresh entries should call `getCurrentWorkerCycleSeq`
   * (peek) instead so the suffix is elided when no re-entry has
   * happened yet — matching the legacy two-axis scope key.
   */
  nextWorkerCycleSeq(turnId: string, taskKey: string): Promise<number>;

  /**
   * Peek (GET-only) the current worker cycle sequence for a
   * (turn, task) pair. Returns 0 when no re-entry has been recorded
   * yet (the suffix is then elided to preserve chat.jsonl BC with
   * the legacy `worker-N#task-K` form).
   */
  getCurrentWorkerCycleSeq(turnId: string, taskKey: string): Promise<number>;

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

  /**
   * Scan every `ant:index:jobsByFeature:*` index key and return each
   * (projectId, featureName, jobIds[]) tuple. Used by StaleJobRecovery
   * Phase 3 to sweep orphan terminal-state job records whose seal was
   * missed (e.g. server crash between status update and key DEL).
   */
  scanJobsByFeatureIndex(): Promise<Array<{
    projectId: string;
    featureName: string;
    jobIds: string[];
  }>>;

  /**
   * Remove a job id from its `ant:index:jobsByFeature:{projectId}:{featureName}`
   * SET entry without touching the associated status record. Used when the
   * status key has already expired (TTL) but the index SET still remembers
   * the stale jobId.
   */
  removeJobFromFeatureIndex(
    projectId: string,
    featureName: string,
    jobId: string,
  ): Promise<void>;

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

  /**
   * Count keys matching a prefix using SCAN (non-blocking).
   * Used for SSE per-connection key counting.
   */
  countKeysByPrefix(prefix: string): Promise<number>;
  
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
