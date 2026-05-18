/**
 * Redis Constants - Central Definition
 * 
 * All Redis keys, TTLs, and Pub/Sub channels.
 * Used by API Server, Job Worker, and Realtime Server.
 */

// ============================================
// Base Prefixes
// ============================================

export const APP_PREFIX = 'ant';

/** Domain prefixes under the app namespace */
export const REDIS_DOMAINS = {
  JOB: `${APP_PREFIX}:job`,
  CHAT: `${APP_PREFIX}:chat`,
  CHOICE: `${APP_PREFIX}:choice`,
  INFRA: `${APP_PREFIX}:infra`,
  INDEX: `${APP_PREFIX}:index`,
  TRANSFER: `${APP_PREFIX}:transfer`,
  ARTIFACTS: `${APP_PREFIX}:artifacts`,
  /** Cross-process lifecycle signaling (cleanup request/ack between API and ant-preview / future ant-* workers). */
  LIFECYCLE: `${APP_PREFIX}:lifecycle`,
  /** Distributed locks + throttle markers (SETNX + value-aware DEL via stateStore.tryAcquireLock / releaseLockIfOwner). */
  LOCK: `${APP_PREFIX}:lock`,
  THROTTLE: `${APP_PREFIX}:throttle`,
  /** Cloud-mode auth records (users / organizations / memberships) — Redis projection of the SQL schema in Phase 3. */
  AUTH: `${APP_PREFIX}:auth`,
} as const;

// ============================================
// Redis Key Definitions
// ============================================

/**
 * Redis Keys - Hierarchical Structure
 * 
 * Usage: `${REDIS_KEYS.JOB.STATUS}${jobId}`
 * Result: "ant:job:status:abc123"
 */
export const REDIS_KEYS = {
  /** Job-related keys (ant:job:*) */
  JOB: {
    /** Job status (running/completed/failed) - ant:job:status:{jobId} */
    STATUS: `${REDIS_DOMAINS.JOB}:status:`,
    /** Kanban task queue snapshot (live, from broadcasts) - ant:job:taskQueue:{jobId} */
    TASK_QUEUE: `${REDIS_DOMAINS.JOB}:taskQueue:`,
    /** Kanban task queue checkpoint (disaster recovery only) - ant:job:taskQueueCheckpoint:{jobId} */
    TASK_QUEUE_CHECKPOINT: `${REDIS_DOMAINS.JOB}:taskQueueCheckpoint:`,
    /** Job to project/feature mapping - ant:job:mapping:{jobId} */
    MAPPING: `${REDIS_DOMAINS.JOB}:mapping:`,
    /** User stop flag - ant:job:userStopped:{jobId} */
    USER_STOPPED: `${REDIS_DOMAINS.JOB}:userStopped:`,
    /** Workflow node state - ant:job:workflow:{jobId} */
    WORKFLOW: `${REDIS_DOMAINS.JOB}:workflow:`,
    /** Pre-SIGTERM kill reason (Worker sets before killing child, job-runner reads on SIGTERM) - ant:job:killReason:{jobId} */
    KILL_REASON: `${REDIS_DOMAINS.JOB}:killReason:`,
  },
  
  /** Chat-related keys (ant:chat:*) */
  CHAT: {
    /**
     * In-flight streaming buffer per turn/worker.
     * `ant:chat:turnBuffer:{sessionKey}:{turnId}:{workerScope}`
     * Value: JSON `{ text?, thinking?, pendingCards? }`. Cleared on
     * finalize. TTL 1h, refreshed on every write.
     */
    TURN_BUFFER: `${REDIS_DOMAINS.CHAT}:turnBuffer:`,
    /**
     * Active turn-buffer index (SET) per session for sync/hard-reset.
     * `ant:chat:turnBufferIdx:{sessionKey}` (SET of `{turnId}:{workerScope}`)
     */
    TURN_BUFFER_INDEX: `${REDIS_DOMAINS.CHAT}:turnBufferIdx:`,
    /**
     * One-shot idempotency for cancelled-card emission.
     * `ant:chat:cancelled-emitted:{turnId}:{pauseSeq}` (SET NX, 24h)
     */
    CANCELLED_EMITTED: `${REDIS_DOMAINS.CHAT}:cancelled-emitted:`,
    /**
     * Monotonic pause sequence per turn for cancelled cardId generation.
     * `ant:chat:pauseSeq:{turnId}` (INCR, 24h)
     *
     * SCOPE: cancelled cardId uniqueness ONLY. The worker scope cycle
     * suffix (`worker-N#task-K#p{cycleSeq}`) is owned by `WORKER_CYCLE_SEQ`
     * below — do NOT collapse the two even though both are monotonic
     * counters. They have different keys (turnId vs turnId×taskKey)
     * and different INCR triggers (Stop only vs all task re-entries).
     */
    CANCELLED_PAUSE_SEQ: `${REDIS_DOMAINS.CHAT}:pauseSeq:`,
    /**
     * Monotonic worker cycle sequence per (turn, task). INCRed by
     * `TaskWorker.executeTask` whenever it picks up a task that bears a
     * re-entry marker (`task.interrupted === true` or
     * `task._failedAttempts > 0`). The new value becomes the `cycleSeq`
     * suffix in `worker-N#task-K#p{cycleSeq}` so re-entered cycles get
     * an isolated FE chat section AND an isolated `LLMResponseService`
     * `WorkerLocalState` slot — the latter is what fixes the stale
     * `fileCardByPath` / `commandCardByCommand` / `thinking` carry-over
     * across batchSplit Path A re-queues / orchestrator transient retry
     * / Stop+Resume cycles (verification re-entry stale-card RCA).
     * `ant:chat:cycleSeq:{turnId}:{taskKey}` (INCR, 24h)
     */
    WORKER_CYCLE_SEQ: `${REDIS_DOMAINS.CHAT}:cycleSeq:`,
    /**
     * Cross-pod chat.jsonl append lock.
     * `ant:chat:chatlogLock:{projectId}:{featureName}:{file}` (SET NX, 5s)
     */
    CHATLOG_LOCK: `${REDIS_DOMAINS.CHAT}:chatlogLock:`,
  },

  /** Choice card resolution keys (ant:choice:*) */
  CHOICE: {
    /**
     * Pending triage choice (legacy slot used by triage node resume flow).
     * `ant:choice:pending:{choiceKey}`
     */
    PENDING: `${REDIS_DOMAINS.CHOICE}:pending:`,
    /**
     * Idempotency flag ensuring choice_resolved is written at most once per cardId.
     * `ant:choice:resolved:{cardId}` (SET NX, 24h)
     */
    RESOLVED_NX: `${REDIS_DOMAINS.CHOICE}:resolved:`,
  },
  
  /** Infrastructure keys (ant:infra:*) */
  INFRA: {
    /** Preview server state - ant:infra:preview:{portKey} */
    PREVIEW: `${REDIS_DOMAINS.INFRA}:preview:`,
    /** Preview server list (SET) - ant:infra:preview:list */
    PREVIEW_LIST: `${REDIS_DOMAINS.INFRA}:preview:list`,
    /** Preview by pod index (SET) - ant:infra:preview:byPod:{podId} */
    PREVIEW_BY_POD: `${REDIS_DOMAINS.INFRA}:preview:byPod:`,
    /** IDE port mapping - ant:infra:ide:{portKey} */
    IDE: `${REDIS_DOMAINS.INFRA}:ide:`,
    /** IDE list (SET) - ant:infra:ide:list */
    IDE_LIST: `${REDIS_DOMAINS.INFRA}:ide:list`,
    /** IDE instance state (K8s) - ant:infra:ide:instance:{instanceKey} */
    IDE_INSTANCE: `${REDIS_DOMAINS.INFRA}:ide:instance:`,
    /** IDE last access time (K8s) - ant:infra:ide:lastAccess:{instanceKey} */
    IDE_LAST_ACCESS: `${REDIS_DOMAINS.INFRA}:ide:lastAccess:`,
    /** Preview config (user settings, separate from runtime state) - ant:infra:preview-config:{portKey} */
    PREVIEW_CONFIG: `${REDIS_DOMAINS.INFRA}:preview-config:`,
    /** Deploy state - ant:infra:deploy:{deployKey} */
    DEPLOY: `${REDIS_DOMAINS.INFRA}:deploy:`,
    /** Deploy list (SET) - ant:infra:deploy:list */
    DEPLOY_LIST: `${REDIS_DOMAINS.INFRA}:deploy:list`,
  },
  
  /** Index keys (ant:index:*) */
  INDEX: {
    /** Jobs by feature index - ant:index:jobsByFeature:{projectId}:{featureName} */
    JOBS_BY_FEATURE: `${REDIS_DOMAINS.INDEX}:jobsByFeature:`,
  },
  
  /** Transfer keys (ant:transfer:*) */
  TRANSFER: {
    /** Transfer request metadata - ant:transfer:request:{requestId} */
    REQUEST: `${REDIS_DOMAINS.TRANSFER}:request:`,
    /** Distributed lock for destination path - ant:transfer:lock:{lockKey} */
    LOCK: `${REDIS_DOMAINS.TRANSFER}:lock:`,
    /** SET of request IDs by recipient - ant:transfer:byRecipient:{orgId}:{userId} */
    BY_RECIPIENT: `${REDIS_DOMAINS.TRANSFER}:byRecipient:`,
    /** SET of request IDs by sender - ant:transfer:bySender:{orgId}:{userId} */
    BY_SENDER: `${REDIS_DOMAINS.TRANSFER}:bySender:`,
  },
  
  /** Unseen artifacts keys (ant:artifacts:*) */
  ARTIFACTS: {
    /** SET of unseen file paths per user/project/feature - ant:artifacts:unseen:{userId}:{projectId}:{featureName} */
    UNSEEN: `${REDIS_DOMAINS.ARTIFACTS}:unseen:`,
    /** Cached file tree per user/project/feature - ant:artifacts:filetree:{userId}:{projectId}:{featureName} */
    FILETREE: `${REDIS_DOMAINS.ARTIFACTS}:filetree:`,
  },

  /**
   * Lifecycle keys (ant:lifecycle:*)
   *
   * Cross-process project / feature cleanup signaling. The API server publishes
   * a `CLEANUP_REQUEST` when a project or feature is deleted; ant-preview (and
   * future workers that own EFS-bound infra state) subscribe and reply on
   * `CLEANUP_ACK`. See [ProjectService.requestPreviewCleanup](../../periphery/adapters/http/services/ProjectService/previewCleanup.ts).
   *
   * Both are pub/sub channels (NOT keys with values). Listed here so the
   * naming convention stays in one place.
   */
  LIFECYCLE: {
    CLEANUP_REQUEST: `${REDIS_DOMAINS.LIFECYCLE}:cleanup:request`,
    CLEANUP_ACK: `${REDIS_DOMAINS.LIFECYCLE}:cleanup:ack`,
  },

  /**
   * Distributed lock keys — `SET key value NX EX ttl` (acquire) +
   * Lua compare-and-DEL (release). See `core/redis/distributedLock.ts`
   * for the helper SSOT.
   *
   * Functions return the full key so callers don't reassemble pieces.
   */
  LOCK: {
    /** Repository clone in progress for (org, user, projectId). */
    CLONE: (org: string, user: string, projectId: string): string =>
      `${REDIS_DOMAINS.LOCK}:clone:${org}:${user}:${projectId}`,
    /** Repository init in progress for (org, user, projectId). */
    INIT: (org: string, user: string, projectId: string): string =>
      `${REDIS_DOMAINS.LOCK}:init:${org}:${user}:${projectId}`,
    /** Repository fetch in progress for (org, user, projectId, feature). */
    FETCH: (org: string, user: string, projectId: string, feature: string): string =>
      `${REDIS_DOMAINS.LOCK}:fetch:${org}:${user}:${projectId}:${feature || 'main'}`,
  },

  /**
   * Throttle markers — same SETNX-EX semantics as LOCK but never released:
   * the TTL itself is the throttle window.
   */
  THROTTLE: {
    /** "worktree corruption sweep already ran for this project recently". */
    WORKTREE_PRUNE: (org: string, user: string, projectId: string): string =>
      `${REDIS_DOMAINS.THROTTLE}:worktree-prune:${org}:${user}:${projectId}`,
  },

  /**
   * Cloud-mode auth — Redis projection of the SQL schema described in the
   * Phase 3 plan. All values are JSON strings; sets are Redis SETs.
   *
   *   organizations table  → ORG record  (ant:auth:org:{orgId})
   *                          + ORG_INDEX SET (full enumeration / search)
   *   memberships table    → ORG_MEMBERS:{orgId} SET (userId list)
   *                          + USER_ORGS:{userId} SET (org list per user)
   *                          + MEMBERSHIP:{orgId}:{userId} JSON (role + createdAt)
   *   users table          → USER record (ant:auth:user:{userId})
   *                          + USER_BY_EMAIL:{emailLower} → userId
   */
  AUTH: {
    /** Organization record - ant:auth:org:{orgId} (JSON) */
    ORG: `${REDIS_DOMAINS.AUTH}:org:`,
    /** All organization ids (SET) - ant:auth:org:index */
    ORG_INDEX: `${REDIS_DOMAINS.AUTH}:org:index`,
    /** User ids that belong to org (SET) - ant:auth:org:members:{orgId} */
    ORG_MEMBERS: `${REDIS_DOMAINS.AUTH}:org:members:`,
    /** Org ids that user belongs to (SET) - ant:auth:user:orgs:{userId} */
    USER_ORGS: `${REDIS_DOMAINS.AUTH}:user:orgs:`,
    /** Membership record (role + createdAt) - ant:auth:membership:{orgId}:{userId} (JSON) */
    MEMBERSHIP: `${REDIS_DOMAINS.AUTH}:membership:`,
    /** User record - ant:auth:user:{userId} (JSON) */
    USER: `${REDIS_DOMAINS.AUTH}:user:`,
    /** Email → userId lookup - ant:auth:user:byEmail:{emailLower} (string) */
    USER_BY_EMAIL: `${REDIS_DOMAINS.AUTH}:user:byEmail:`,
  },
} as const;

// ============================================
// TTLs (in seconds)
// ============================================

export const REDIS_TTL = {
  /** Job-related TTLs */
  JOB: {
    STATUS: 24 * 60 * 60,        // 24 hours
    TASK_QUEUE: 24 * 60 * 60,    // 24 hours
    MAPPING: 24 * 60 * 60,       // 24 hours
    USER_STOPPED: 60 * 60,       // 1 hour
    WORKFLOW: 24 * 60 * 60,      // 24 hours
    KILL_REASON: 60,             // 60s — only needed during SIGTERM window
  },
  
  /** Chat-related TTLs */
  CHAT: {
    /** Turn buffer — in-flight streaming snapshots. Refreshed on every write. */
    TURN_BUFFER: 60 * 60,            // 1 hour
    /** Cancelled emission idempotency flag. */
    CANCELLED_EMITTED: 24 * 60 * 60, // 24 hours
    /** Pause sequence (auto-INCR, kept for session lifetime). */
    CANCELLED_PAUSE_SEQ: 24 * 60 * 60, // 24 hours
    /** Per-(turn, task) worker cycle sequence (auto-INCR on re-entry). */
    WORKER_CYCLE_SEQ: 24 * 60 * 60, // 24 hours
    /** Cross-pod chat.jsonl append lock. */
    CHATLOG_LOCK: 5,                  // 5 seconds
  },

  /** Choice TTLs */
  CHOICE: {
    PENDING: 30 * 60,            // 30 minutes
    /** Choice resolution idempotency NX flag. */
    RESOLVED_NX: 24 * 60 * 60,  // 24 hours
  },
  
  /** Infrastructure TTLs */
  INFRA: {
    PORT_MAPPING: 24 * 60 * 60,  // 24 hours
    PREVIEW_CONFIG: 30 * 24 * 60 * 60,  // 30 days (user config, persists across preview restarts)
    DEPLOY: 7 * 24 * 60 * 60,           // 7 days (deployed static builds)
  },
  
  /** Transfer TTLs */
  TRANSFER: {
    REQUEST: 7 * 24 * 60 * 60,   // 7 days
    LOCK: 300,                     // 5 minutes
  },
  
  /** Unseen artifacts TTLs */
  ARTIFACTS: {
    UNSEEN: 7 * 24 * 60 * 60,    // 7 days
    FILETREE: 24 * 60 * 60,      // 24 hours (aligned with job lifecycle)
  },
} as const;

// ============================================
// Pub/Sub Channel Definitions
// ============================================

/** Channel domain prefixes */
export const CHANNEL_DOMAINS = {
  REALTIME: 'realtime',
  JOB: 'job',
} as const;

/**
 * Pub/Sub Channels (grouped by subscriber)
 */
export const REDIS_CHANNELS = {
  /** Realtime Server subscribes - forwards to frontend via SSE */
  REALTIME: {
    BROADCAST_PREFIX: `${CHANNEL_DOMAINS.REALTIME}:broadcast:`,
    WORKFLOW_PREFIX: `${CHANNEL_DOMAINS.REALTIME}:workflow:`,
  },
  
  /** Job Worker subscribes - process control signals */
  JOB_WORKER: {
    STOP: `${CHANNEL_DOMAINS.JOB}:stop`,
  },
  
  /** API Server subscribes - job completion/failure notifications */
  API_SERVER: {
    JOB_STATUS_UPDATES: `${CHANNEL_DOMAINS.JOB}:status:updates`,
  },
  
  /** Chat sync: SSE API Pod → Worker Pod snapshot request */
  CHAT: {
    SYNC_PREFIX: `${REDIS_DOMAINS.CHAT}:sync:`,
    /**
     * Choice-resolution fanout: API server publishes when user answers a
     * choice card so the waiting worker resolves its promise.
     * Format: `ant:chat:choice-resolved:{sessionKey}`
     */
    CHOICE_RESOLVED_PREFIX: `${REDIS_DOMAINS.CHAT}:choice-resolved:`,
  },
} as const;

// ============================================
// Channel Generation Functions
// ============================================

/**
 * Generate user-scoped broadcast channel
 * Format: realtime:broadcast:{orgId}:{userId}
 */
export function getRealtimeBroadcastChannel(orgId: string, userId: string): string {
  if (!orgId || !userId) {
    throw new Error(`Invalid channel params: orgId=${orgId}, userId=${userId}`);
  }
  return `${REDIS_CHANNELS.REALTIME.BROADCAST_PREFIX}${orgId}:${userId}`;
}

/**
 * Generate user-scoped workflow channel
 * Format: realtime:workflow:{orgId}:{userId}
 */
export function getRealtimeWorkflowChannel(orgId: string, userId: string): string {
  if (!orgId || !userId) {
    throw new Error(`Invalid channel params: orgId=${orgId}, userId=${userId}`);
  }
  return `${REDIS_CHANNELS.REALTIME.WORKFLOW_PREFIX}${orgId}:${userId}`;
}

/**
 * Parse user context from channel name
 * Returns { orgId, userId } or null if invalid format
 */
export function parseChannelUserContext(channel: string): { orgId: string; userId: string } | null {
  const match = channel.match(/^realtime:(broadcast|workflow):([^:]+):([^:]+)$/);
  if (!match) return null;
  return { orgId: match[2], userId: match[3] };
}

/**
 * Generate chat sync channel for a session.
 * Worker Pod subscribes; SSE API Pod publishes sync_request on client reconnect.
 */
export function getChatSyncChannel(sessionKey: string): string {
  return `${REDIS_CHANNELS.CHAT.SYNC_PREFIX}${sessionKey}`;
}

/**
 * Generate choice-resolved fanout channel for a session.
 * API Server publishes `{ cardId, choiceSelected, resolvedLabel, answer? }`
 * when the user answers a choice card; the worker subscribes and resolves
 * the matching `sendTriageChoice` / `sendChoiceCard` / `sendClarifyCards`
 * promise.
 */
export function getChoiceResolvedChannel(sessionKey: string): string {
  return `${REDIS_CHANNELS.CHAT.CHOICE_RESOLVED_PREFIX}${sessionKey}`;
}

// ============================================
// Chat Turn Buffer Helpers
// ============================================

/**
 * Build a per-(turn, workerScope) turn-buffer key.
 * Format: `ant:chat:turnBuffer:{sessionKey}:{turnId}:{workerScope}`
 * `workerScope` defaults to `_main_` for the main graph.
 */
export function getTurnBufferKey(sessionKey: string, turnId: string, workerScope?: string): string {
  const scope = workerScope && workerScope.length > 0 ? workerScope : '_main_';
  return `${REDIS_KEYS.CHAT.TURN_BUFFER}${sessionKey}:${turnId}:${scope}`;
}

export function getTurnBufferIndexKey(sessionKey: string): string {
  return `${REDIS_KEYS.CHAT.TURN_BUFFER_INDEX}${sessionKey}`;
}

export function getTurnBufferIndexMember(turnId: string, workerScope?: string): string {
  const scope = workerScope && workerScope.length > 0 ? workerScope : '_main_';
  return `${turnId}:${scope}`;
}

export function parseTurnBufferIndexMember(member: string): { turnId: string; workerScope: string } {
  const idx = member.lastIndexOf(':');
  if (idx < 0) return { turnId: member, workerScope: '_main_' };
  return { turnId: member.slice(0, idx), workerScope: member.slice(idx + 1) };
}

export function getCancelledEmittedKey(turnId: string, pauseSeq: number): string {
  return `${REDIS_KEYS.CHAT.CANCELLED_EMITTED}${turnId}:${pauseSeq}`;
}

export function getCancelledPauseSeqKey(turnId: string): string {
  return `${REDIS_KEYS.CHAT.CANCELLED_PAUSE_SEQ}${turnId}`;
}

/**
 * Per-(turn, task) worker cycle sequence key. The taskKey segment is
 * the `task.id || task.name` value `TaskWorker` already uses for the
 * `worker-N#task-K` scope — keeping the partition unit identical
 * across redis and ALS is what guarantees the cycleSeq INCR isolates
 * one task's re-entries from sibling tasks in the same turn.
 */
export function getWorkerCycleSeqKey(turnId: string, taskKey: string): string {
  return `${REDIS_KEYS.CHAT.WORKER_CYCLE_SEQ}${turnId}:${taskKey}`;
}

export function getChatLogLockKey(projectId: string, featureName: string, file: 'feature' | 'chat'): string {
  return `${REDIS_KEYS.CHAT.CHATLOG_LOCK}${projectId}:${featureName}:${file}`;
}

export function getChoiceResolvedNXKey(cardId: string): string {
  return `${REDIS_KEYS.CHOICE.RESOLVED_NX}${cardId}`;
}
