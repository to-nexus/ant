/**
 * State Store Module
 * 
 * Exports state storage implementations for ant-cli.
 * 
 * Usage:
 * - All environments use RedisStateStore
 */

export { RedisStateStore } from './RedisStateStore';
export type { RedisStateStoreOptions } from './RedisStateStore';

// ============================================
// Redis Constants - Central Definition
// ============================================
// ALL Redis keys, TTLs, and channels MUST be imported from here!
export {
  // App prefix (for pattern matching like KEYS 'ant:*')
  APP_PREFIX,
  // Hierarchical key/TTL/channel structure
  REDIS_KEYS,
  REDIS_TTL,
  REDIS_CHANNELS,
  REDIS_DOMAINS,
  CHANNEL_DOMAINS,
  
  // Channel generation functions
  getRealtimeBroadcastChannel,
  getRealtimeWorkflowChannel,
  parseChannelUserContext,
} from './redisConstants';

// Re-export types from port
export type {
  StateStorePort,
  JobStatusData,
  JobStatusValue,
  PortMapping
} from '../../core/ports/stateStore';

// Re-export task types from core
export type {
  TaskQueueSnapshot,
  JobProjectMapping,
  KanbanData,
  KanbanBroadcastMessage
} from '../../core/types/task';