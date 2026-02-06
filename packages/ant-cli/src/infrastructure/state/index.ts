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
  REDIS_KEYS,
  REDIS_TTL,
  REDIS_CHANNELS,
  // Legacy aliases
  KEYS,
  TTL,
  SSE_BROADCAST_CHANNEL,
  SSE_WORKFLOW_CHANNEL,
} from './redisConstants';

export type {
  RedisKeyType,
  RedisTTLType,
  RedisChannelType,
} from './redisConstants';

// Re-export types from port (excluding LogEntry to avoid duplication)
export type {
  StateStorePort,
  JobStatusData,
  JobStatusValue,
  TaskQueueSnapshot,
  JobProjectMapping,
  PortMapping
} from '../../core/ports/stateStore';
