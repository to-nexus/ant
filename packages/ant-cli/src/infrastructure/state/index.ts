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

// Re-export types from port (excluding LogEntry to avoid duplication)
export type {
  StateStorePort,
  JobStatusData,
  JobStatusValue,
  TaskQueueSnapshot,
  JobProjectMapping,
  PortMapping
} from '../../core/ports/stateStore';
