/**
 * Redis Constants - Central Definition
 * 
 * All Redis keys, TTLs, and Pub/Sub channels.
 * Used by API Server, Job Worker, and Realtime Server.
 */

// ============================================
// Base Prefixes
// ============================================

const APP_PREFIX = 'ant';

/** Domain prefixes under the app namespace */
export const REDIS_DOMAINS = {
  JOB: `${APP_PREFIX}:job`,
  CHAT: `${APP_PREFIX}:chat`,
  CHOICE: `${APP_PREFIX}:choice`,
  INFRA: `${APP_PREFIX}:infra`,
  INDEX: `${APP_PREFIX}:index`,
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
    /** Kanban task queue snapshot - ant:job:taskQueue:{jobId} */
    TASK_QUEUE: `${REDIS_DOMAINS.JOB}:taskQueue:`,
    /** Job to project/feature mapping - ant:job:mapping:{jobId} */
    MAPPING: `${REDIS_DOMAINS.JOB}:mapping:`,
    /** User stop flag - ant:job:userStopped:{jobId} */
    USER_STOPPED: `${REDIS_DOMAINS.JOB}:userStopped:`,
    /** Workflow node state - ant:job:workflow:{jobId} */
    WORKFLOW: `${REDIS_DOMAINS.JOB}:workflow:`,
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
    /** IDE port mapping - ant:infra:ide:{portKey} */
    IDE: `${REDIS_DOMAINS.INFRA}:ide:`,
    /** IDE list (SET) - ant:infra:ide:list */
    IDE_LIST: `${REDIS_DOMAINS.INFRA}:ide:list`,
  },
  
  /** Index keys (ant:index:*) */
  INDEX: {
    /** Jobs by feature index - ant:index:jobsByFeature:{projectId}:{featureName} */
    JOBS_BY_FEATURE: `${REDIS_DOMAINS.INDEX}:jobsByFeature:`,
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
  },
} as const;

// ============================================
// Pub/Sub Channel Definitions
// ============================================

/** Channel domain prefixes */
export const CHANNEL_DOMAINS = {
  SSE: 'sse',
  JOB: 'job',
} as const;

/**
 * Pub/Sub Channels (grouped by subscriber)
 */
export const REDIS_CHANNELS = {
  /** Realtime Server subscribes - forwards to frontend via SSE */
  REALTIME: {
    BROADCAST_PREFIX: `${CHANNEL_DOMAINS.SSE}:broadcast:`,
    WORKFLOW_PREFIX: `${CHANNEL_DOMAINS.SSE}:workflow:`,
  },
  
  /** Job Worker subscribes - backend process control */
  JOB_WORKER: {
    STOP: `${CHANNEL_DOMAINS.JOB}:stop`,
  },
} as const;

// ============================================
// Channel Generation Functions
// ============================================

/**
 * Generate user-scoped SSE broadcast channel
 * Format: sse:broadcast:{orgId}:{userId}
 */
export function getSSEBroadcastChannel(orgId: string, userId: string): string {
  if (!orgId || !userId) {
    throw new Error(`Invalid channel params: orgId=${orgId}, userId=${userId}`);
  }
  return `${REDIS_CHANNELS.REALTIME.BROADCAST_PREFIX}${orgId}:${userId}`;
}

/**
 * Generate user-scoped SSE workflow channel
 * Format: sse:workflow:{orgId}:{userId}
 */
export function getSSEWorkflowChannel(orgId: string, userId: string): string {
  if (!orgId || !userId) {
    throw new Error(`Invalid channel params: orgId=${orgId}, userId=${userId}`);
  }
  return `${REDIS_CHANNELS.REALTIME.WORKFLOW_PREFIX}${orgId}:${userId}`;
}

/**
 * Generate job-scoped stop channel (for future use)
 * Format: job:stop:{jobId}
 */
export function getJobStopChannel(jobId: string): string {
  if (!jobId) {
    throw new Error(`Invalid channel param: jobId=${jobId}`);
  }
  return `${CHANNEL_DOMAINS.JOB}:stop:${jobId}`;
}

/**
 * Parse user context from channel name
 * Returns { orgId, userId } or null if invalid format
 */
export function parseChannelUserContext(channel: string): { orgId: string; userId: string } | null {
  const match = channel.match(/^sse:(broadcast|workflow):([^:]+):([^:]+)$/);
  if (!match) return null;
  return { orgId: match[2], userId: match[3] };
}

/**
 * Parse jobId from stop channel
 * Returns jobId or null if invalid format
 */
export function parseJobStopChannel(channel: string): string | null {
  const match = channel.match(/^job:stop:(.+)$/);
  return match ? match[1] : null;
}

// ============================================
// Key Helper Functions
// ============================================

/** Build a full key with jobId */
export function buildJobKey(keyPrefix: string, jobId: string): string {
  return `${keyPrefix}${jobId}`;
}

/** Build a full key with session key */
export function buildSessionKey(keyPrefix: string, sessionKey: string): string {
  return `${keyPrefix}${sessionKey}`;
}

// ============================================
// Type Exports
// ============================================

export type RedisKeyDomain = typeof REDIS_KEYS[keyof typeof REDIS_KEYS];
export type RedisTTLDomain = typeof REDIS_TTL[keyof typeof REDIS_TTL];
export type RedisChannelDomain = typeof REDIS_CHANNELS[keyof typeof REDIS_CHANNELS];

