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
    /** Job execution logs - ant:job:logs:{jobId} */
    LOGS: `${REDIS_DOMAINS.JOB}:logs:`,
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
    /** Chat session data - ant:chat:session:{sessionKey} */
    SESSION: `${REDIS_DOMAINS.CHAT}:session:`,
    /** Currently streaming message - ant:chat:currentMessage:{sessionKey} */
    CURRENT_MESSAGE: `${REDIS_DOMAINS.CHAT}:currentMessage:`,
  },
  
  /** Choice/Triage keys (ant:choice:*) */
  CHOICE: {
    /** Pending triage choice - ant:choice:pending:{choiceKey} */
    PENDING: `${REDIS_DOMAINS.CHOICE}:pending:`,
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
} as const;

// ============================================
// TTLs (in seconds)
// ============================================

export const REDIS_TTL = {
  /** Job-related TTLs */
  JOB: {
    STATUS: 24 * 60 * 60,        // 24 hours
    LOGS: 7 * 24 * 60 * 60,      // 7 days
    TASK_QUEUE: 24 * 60 * 60,    // 24 hours
    MAPPING: 24 * 60 * 60,       // 24 hours
    USER_STOPPED: 60 * 60,       // 1 hour
    WORKFLOW: 24 * 60 * 60,      // 24 hours
    KILL_REASON: 60,             // 60s — only needed during SIGTERM window
  },
  
  /** Chat-related TTLs */
  CHAT: {
    SESSION: 24 * 60 * 60,       // 24 hours
    CURRENT_MESSAGE: 60 * 60,    // 1 hour (streaming)
  },
  
  /** Choice TTLs */
  CHOICE: {
    PENDING: 30 * 60,            // 30 minutes
  },
  
  /** Infrastructure TTLs */
  INFRA: {
    PORT_MAPPING: 24 * 60 * 60,  // 24 hours
    PREVIEW_CONFIG: 30 * 24 * 60 * 60,  // 30 days (user config, persists across preview restarts)
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
