/**
 * Redis Constants - Central Definition
 * 
 * ALL Redis keys, TTLs, and Pub/Sub channels MUST be defined here.
 * This ensures consistency across:
 * - RedisStateStore (API Server, Job Worker)
 * - SSEService (Realtime Server)
 * - core/realtime Broadcasters (Job Worker child processes)
 * 
 * IMPORTANT: Do NOT define Redis keys/channels elsewhere!
 * Always import from this file.
 */

// ============================================
// Redis Key Prefixes
// ============================================

export const REDIS_KEYS = {
  // Job-related keys
  JOB_STATUS: 'ant:job:status:',
  JOB_LOGS: 'ant:job:logs:',
  TASK_QUEUE: 'ant:job:taskQueue:',
  JOB_MAPPING: 'ant:job:mapping:',
  USER_STOPPED: 'ant:job:userStopped:',
  JOBS_BY_FEATURE: 'ant:index:jobsByFeature:',
  
  // Infrastructure keys
  PREVIEW: 'ant:preview:',
  IDE: 'ant:ide:',
  PREVIEW_LIST: 'ant:previews',
  IDE_LIST: 'ant:ides',
  
  // Chat session keys
  CHAT_SESSION: 'ant:chat:session:',
  CHAT_CURRENT_MESSAGE: 'ant:chat:currentMessage:',
  
  // Workflow state keys
  WORKFLOW_STATE: 'ant:workflow:state:',
  
  // Choice/Triage keys
  PENDING_CHOICE: 'ant:choice:pending:',
} as const;

// ============================================
// TTLs (in seconds)
// ============================================

export const REDIS_TTL = {
  JOB_STATUS: 24 * 60 * 60,      // 24 hours
  JOB_LOGS: 7 * 24 * 60 * 60,    // 7 days
  TASK_QUEUE: 24 * 60 * 60,      // 24 hours
  PORT_MAPPING: 24 * 60 * 60,    // 24 hours
  USER_STOPPED: 60 * 60,         // 1 hour
  CHAT_SESSION: 24 * 60 * 60,    // 24 hours
  CHAT_CURRENT_MESSAGE: 60 * 60, // 1 hour (streaming message)
  WORKFLOW_STATE: 24 * 60 * 60,  // 24 hours
  PENDING_CHOICE: 30 * 60,       // 30 minutes
} as const;

// ============================================
// Pub/Sub Channels
// ============================================

export const REDIS_CHANNELS = {
  // SSE broadcast channels (Realtime Server subscribes)
  SSE_BROADCAST: 'sse:broadcast',   // Kanban, FileTree, Preview, Job status
  SSE_WORKFLOW: 'sse:workflow',     // Workflow state updates
  
  // Job control channels
  JOB_STOP: 'job:stop',             // Stop signal from API to Job Worker
} as const;

// ============================================
// Type exports for type safety
// ============================================

export type RedisKeyType = typeof REDIS_KEYS[keyof typeof REDIS_KEYS];
export type RedisTTLType = typeof REDIS_TTL[keyof typeof REDIS_TTL];
export type RedisChannelType = typeof REDIS_CHANNELS[keyof typeof REDIS_CHANNELS];

// ============================================
// Legacy aliases (for backward compatibility)
// ============================================

/** @deprecated Use REDIS_KEYS instead */
export const KEYS = REDIS_KEYS;

/** @deprecated Use REDIS_TTL instead */
export const TTL = REDIS_TTL;

/** @deprecated Use REDIS_CHANNELS.SSE_BROADCAST instead */
export const SSE_BROADCAST_CHANNEL = REDIS_CHANNELS.SSE_BROADCAST;

/** @deprecated Use REDIS_CHANNELS.SSE_WORKFLOW instead */
export const SSE_WORKFLOW_CHANNEL = REDIS_CHANNELS.SSE_WORKFLOW;
