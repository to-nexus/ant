/**
 * Redis Constants - Central Definition
 * 
 * All Redis keys, TTLs, and Pub/Sub channels.
 * Used by API Server, Job Worker, and Realtime Server.
 */

import { CREDIT_LEDGER_MAX_ENTRIES } from '@ant/shared';

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
  /** Compaction-aware baseline-estimate cache (per-tenant + per-(intent, model, RAC, draft)). */
  BASELINE: `${APP_PREFIX}:baseline`,
  /** Credit billing — balance / ledger / account / in-flight hold (per org+user). */
  BILLING: `${APP_PREFIX}:billing`,
  /** Cloud-mode admin config (global default-approval policy). */
  ADMIN: `${APP_PREFIX}:admin`,
  /** Pipeline scheduling — live-run projections rebuildable from the disk SSOT (`.ant/pipelines`). */
  PIPE: `${APP_PREFIX}:pipe`,
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
    /**
     * cardId → turnId index for cross-process choice-resolved lookup.
     * `ant:choice:card:{cardId}` → JSON `{turnId, jobId, jobType, workerScope?}` (7d TTL).
     *
     * Written by the choice-emitting process at the chat-line persistence
     * chokepoint; read by the API server's `/chat/choice-resolved` handler
     * before falling back to a `chat.jsonl` scan. Closes the EFS/NFS
     * read-after-write visibility gap where the worker's append is not
     * yet visible to the API server's NFS client when the FE clicks.
     */
    CARD_INDEX: `${REDIS_DOMAINS.CHOICE}:card:`,
  },
  
  /** Infrastructure keys (ant:infra:*) */
  INFRA: {
    /** Preview server state - ant:infra:preview:{portKey} */
    PREVIEW: `${REDIS_DOMAINS.INFRA}:preview:`,
    /** Preview server list (SET) - ant:infra:preview:list */
    PREVIEW_LIST: `${REDIS_DOMAINS.INFRA}:preview:list`,
    /** Preview by pod index (SET) - ant:infra:preview:byPod:{podId} */
    PREVIEW_BY_POD: `${REDIS_DOMAINS.INFRA}:preview:byPod:`,
    /** Preview DNS-label → portKey index (O(1) subdomain resolve) - ant:infra:preview:labelidx:{label} */
    PREVIEW_LABEL_IDX: `${REDIS_DOMAINS.INFRA}:preview:labelidx:`,
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
    /** Deploy DNS-label → deployKey index (O(1) subdomain resolve) - ant:infra:deploy:labelidx:{label} */
    DEPLOY_LABEL_IDX: `${REDIS_DOMAINS.INFRA}:deploy:labelidx:`,
    /** Custom domain record (deploy-only), keyed by lowercased hostname - ant:infra:customdomain:{hostname} */
    CUSTOM_DOMAIN: `${REDIS_DOMAINS.INFRA}:customdomain:`,
    /** Custom domain list (SET of hostnames) - ant:infra:customdomain:list */
    CUSTOM_DOMAIN_LIST: `${REDIS_DOMAINS.INFRA}:customdomain:list`,
    /** Custom domains for a deploy (SET of hostnames) - ant:infra:customdomain:byDeploy:{deployKey} */
    CUSTOM_DOMAIN_BY_DEPLOY: `${REDIS_DOMAINS.INFRA}:customdomain:byDeploy:`,
    /**
     * Port allocation claim (SET NX) - ant:infra:port:{type}:{port}
     *
     * Redis-authoritative dynamic port allocator. A claim is an atomic
     * `SET key value NX EX ttl`, making a port number globally unique across
     * every ant-preview pod (the old pod-local in-memory `usedPorts` set let
     * two pods hand out the same number — the root of cross-project preview
     * kills). The value carries the owner `{podId, serverKey, pid}` for
     * diagnostics; the TTL is the dead-pod backstop (a crashed pod's claims
     * self-expire back into the pool). SSOT: `PortManager`.
     */
    PORT_CLAIM: (type: string, port: number): string =>
      `${REDIS_DOMAINS.INFRA}:port:${type}:${port}`,
    /** Per-type allocation cursor (INCR) - ant:infra:port:cursor:{type} */
    PORT_CURSOR: (type: string): string =>
      `${REDIS_DOMAINS.INFRA}:port:cursor:${type}`,
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
    // Fire-and-forget (no ack): API publishes after a code job finalizes so the
    // ant-preview process re-detects connections from the FINAL code, replacing
    // the snapshot cached early in the job (before later seam/error tasks renamed
    // dirs / env vars). Without this the post-job panel shows a stale snapshot and
    // the Real/Virtualized toggle writes an env var the code no longer references.
    CONNECTIONS_REFRESH: `${REDIS_DOMAINS.LIFECYCLE}:connections:refresh`,
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
      `${REDIS_DOMAINS.LOCK}:fetch:${org}:${user}:${projectId}:${feature || '@anchor'}`,
    /**
     * Commit in progress for (org, user, projectId, feature). Serializes the
     * multi-step ant-commit (group loop) so concurrent commits can't interleave
     * `git add` / `git commit` on the same worktree.
     */
    COMMIT: (org: string, user: string, projectId: string, feature: string): string =>
      `${REDIS_DOMAINS.LOCK}:commit:${org}:${user}:${projectId}:${feature || '@anchor'}`,
    /**
     * Feature create/delete + branchBase mutation critical section for
     * (org, user, projectId). Serializes worktree lifecycle against the
     * branchBase pointer auto-apply rules.
     */
    FEATURE_LIFECYCLE: (org: string, user: string, projectId: string): string =>
      `${REDIS_DOMAINS.LOCK}:feature-lifecycle:${org}:${user}:${projectId}`,
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
    /**
     * All user ids (SET) - ant:auth:user:index. Enables admin enumeration
     * (users are otherwise reachable only via the byEmail lookup). Backfilled
     * via SCAN on first listUsers call.
     */
    USER_INDEX: `${REDIS_DOMAINS.AUTH}:user:index`,
    /** Team invitation record - ant:auth:invite:{id} (JSON) */
    INVITE: `${REDIS_DOMAINS.AUTH}:invite:`,
    /** Invite token → inviteId lookup - ant:auth:invite:byToken:{token} (string) */
    INVITE_BY_TOKEN: `${REDIS_DOMAINS.AUTH}:invite:byToken:`,
    /** Invite ids issued by an org (SET) - ant:auth:org:invites:{orgId} */
    ORG_INVITES: `${REDIS_DOMAINS.AUTH}:org:invites:`,
    /** Invite ids addressed to an email (SET) - ant:auth:invites:byEmail:{emailLower} */
    INVITES_BY_EMAIL: `${REDIS_DOMAINS.AUTH}:invites:byEmail:`,
    /** Org domain claim - ant:auth:domain:{domain} (JSON; domain is the global PK) */
    DOMAIN: `${REDIS_DOMAINS.AUTH}:domain:`,
    /** Domains claimed by an org (SET) - ant:auth:org:domains:{orgId} */
    ORG_DOMAINS: `${REDIS_DOMAINS.AUTH}:org:domains:`,
  },

  /** Cloud-mode admin (ant:admin:*) */
  ADMIN: {
    /** Global default-approval policy - ant:admin:config (JSON) */
    CONFIG: `${REDIS_DOMAINS.ADMIN}:config`,
  },

  /**
   * Baseline estimate cache (ant:baseline:*)
   *
   * Tenant-scoped per-(intent, model, RAC fingerprint, draft hash). 5-min TTL
   * amortises the Anthropic countTokens call across rapid keystrokes inside
   * the 300ms debounce window. SSOT: `core/baselineEstimate/cache.ts`.
   *
   * Key shape:
   *   ant:baseline:{orgId}:{userId}:{projectId}:{featureName}:{intent}:{modelId}:{racFp}:{draftHash}
   */
  BASELINE: {
    KEY: (
      orgId: string,
      userId: string,
      projectId: string,
      featureName: string,
      intent: string,
      modelId: string,
      racFingerprint: string,
      draftHash: string,
    ): string =>
      `${REDIS_DOMAINS.BASELINE}:${orgId}:${userId}:${projectId}:${featureName}:${intent}:${modelId}:${racFingerprint}:${draftHash}`,
  },

  /**
   * Credit billing (ant:billing:*) — per org+user scoped, mirroring the
   * TRANSFER / BASELINE tenant-scoping convention. For the shared `individual`
   * org this is effectively per-user; the `team` seam aggregates at org level
   * later. All values JSON except BALANCE (integer micro-credits for atomic
   * INCRBY/DECRBY) and LEDGER (Redis LIST of JSON transactions).
   */
  BILLING: {
    /** Integer micro-credit balance - ant:billing:balance:{orgId}:{userId} */
    BALANCE: (org: string, user: string): string =>
      `${REDIS_DOMAINS.BILLING}:balance:${org}:${user}`,
    /** Append-only transaction LIST - ant:billing:ledger:{orgId}:{userId} */
    LEDGER: (org: string, user: string): string =>
      `${REDIS_DOMAINS.BILLING}:ledger:${org}:${user}`,
    /** Subscription + monthly-grant cycle state (JSON) - ant:billing:account:{orgId}:{userId} */
    ACCOUNT: (org: string, user: string): string =>
      `${REDIS_DOMAINS.BILLING}:account:${org}:${user}`,
    /** In-flight reservation hold record (JSON {org,user,micro}) for a running job - ant:billing:hold:{jobId} */
    HOLD: (jobId: string): string => `${REDIS_DOMAINS.BILLING}:hold:${jobId}`,
    /** Per-user aggregate held micro-credits across concurrent jobs - ant:billing:held:{orgId}:{userId} */
    HELD: (org: string, user: string): string =>
      `${REDIS_DOMAINS.BILLING}:held:${org}:${user}`,
    /** Per-job debit idempotency lock - ant:billing:debit:{jobId} */
    DEBIT_LOCK: (jobId: string): string => `${REDIS_DOMAINS.BILLING}:debit:${jobId}`,
    /** Per-job cumulative micro-credits already debited (monotonic). Drives
     *  incremental live metering: each tick raises this toward the job's
     *  cumulative cost and debits only the positive delta. - ant:billing:charged:{jobId} */
    CHARGED: (jobId: string): string => `${REDIS_DOMAINS.BILLING}:charged:${jobId}`,
    /** Monthly grant lock (one grant per cycle) - ant:billing:grantLock:{orgId}:{userId} */
    GRANT_LOCK: (org: string, user: string): string =>
      `${REDIS_DOMAINS.BILLING}:grantLock:${org}:${user}`,
  },

  /**
   * Pipeline scheduling (ant:pipe:*) — every key here is a PROJECTION of the
   * disk SSOT (definition yaml + activation/runs JSONL) and must be
   * rebuildable by the reconciler. Never promote one to source of truth.
   * Activation-unit keys are keyed by PROJECT (one activation per project is
   * structural), so the same pipeline may run concurrently on many projects.
   */
  PIPE: {
    /** Live run state document (JSON RunRecord) - ant:pipe:run:{runId} */
    RUN: (runId: string): string => `${REDIS_DOMAINS.PIPE}:run:${runId}`,
    /** Overlap guard (NX, value = runId), per activation - ant:pipe:active:{orgId}:{userId}:{projectId} */
    ACTIVE: (org: string, user: string, projectId: string): string =>
      `${REDIS_DOMAINS.PIPE}:active:${org}:${user}:${projectId}`,
    /** Fire idempotency (NX) - ant:pipe:fired:{orgId}:{userId}:{projectId}:{fireEpoch} */
    FIRED: (org: string, user: string, projectId: string, fireEpoch: number): string =>
      `${REDIS_DOMAINS.PIPE}:fired:${org}:${user}:${projectId}:${fireEpoch}`,
    /** jobId → {runId, stepId} reverse mapping for the status-update consumer - ant:pipe:job:{jobId} */
    JOB: (jobId: string): string => `${REDIS_DOMAINS.PIPE}:job:${jobId}`,
    /** Armed HITL gate (JSON) - ant:pipe:hitl:{gateId} */
    HITL: (gateId: string): string => `${REDIS_DOMAINS.PIPE}:hitl:${gateId}`,
    /** cardId → gateId reverse mapping for the choice-resolved consumer - ant:pipe:card:{cardId} */
    CARD: (cardId: string): string => `${REDIS_DOMAINS.PIPE}:card:${cardId}`,
    /** Per-run coordinator mutation lock - ant:lock:pipe-run:{runId} */
    RUN_LOCK: (runId: string): string => `${REDIS_DOMAINS.LOCK}:pipe-run:${runId}`,
    /** Activation record projection (JSON PipelineActivation) - ant:pipe:actv:{orgId}:{userId}:{projectId} */
    ACTIVATION: (org: string, user: string, projectId: string): string =>
      `${REDIS_DOMAINS.PIPE}:actv:${org}:${user}:${projectId}`,
    /** projectId → pipelineId reverse mapping — the job-start mutual-exclusion
     *  gate read. TTL-bounded and refreshed by the reconciler: a stale entry
     *  self-clears, so the gate fails OPEN, never closed. - ant:pipe:proj:{orgId}:{userId}:{projectId} */
    PROJECT: (org: string, user: string, projectId: string): string =>
      `${REDIS_DOMAINS.PIPE}:proj:${org}:${user}:${projectId}`,
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
    /**
     * Port allocation claim. Moderate window refreshed by PortManager's
     * in-pod TTL refresh while the claim is live; a dead pod's claims lapse
     * after this and return to the pool. Must comfortably exceed the refresh
     * interval (TTL/3) so a live claim never expires mid-use.
     */
    PORT_CLAIM: 10 * 60,                // 10 minutes
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

  /** Baseline estimate cache TTL — 5 minutes. */
  BASELINE: {
    ENTRY: 300,
  },

  /** Credit billing TTLs. Balance/ledger/account are durable (no TTL). */
  BILLING: {
    /** In-flight reservation hold — bounded to a generous job-runtime window
     *  so an abandoned/crashed job's hold self-clears instead of leaking. */
    HOLD: 6 * 60 * 60,            // 6 hours
    /** Debit idempotency lock — long enough to outlast any finalize retry. */
    DEBIT_LOCK: 24 * 60 * 60,     // 24 hours
    /** Per-job cumulative-charged marker — outlives the job + finalize retry. */
    CHARGED: 24 * 60 * 60,        // 24 hours
    /** Max ledger entries kept per account (LTRIM). SSOT: @ant/shared. */
    LEDGER_MAX_ENTRIES: CREDIT_LEDGER_MAX_ENTRIES,
  },

  /** Pipeline scheduling TTLs — projections only (disk JSONL is the record). */
  PIPE: {
    /** Live run doc; refreshed on every coordinator write, kept 7d past terminal. */
    RUN: 7 * 24 * 60 * 60,
    /** Overlap guard — bounds a single run (incl. human waits) to 30 days. */
    ACTIVE: 30 * 24 * 60 * 60,
    /** Fire idempotency window. */
    FIRED: 48 * 60 * 60,
    /** jobId → run/step reverse mapping. */
    JOB: 7 * 24 * 60 * 60,
    /** Armed gate + card reverse mapping — same 30d bound as ACTIVE. */
    HITL: 30 * 24 * 60 * 60,
    /** Coordinator per-run mutation lock. */
    RUN_LOCK: 30,
    /**
     * Activation + project reverse-map projections. Refreshed by the
     * reconciler (90s) and the activate route; must comfortably exceed the
     * refresh interval so a live activation never lapses mid-use, while a
     * crash between disk unlink and Redis delete self-clears within this.
     */
    ACTIVATION: 10 * 60,
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
