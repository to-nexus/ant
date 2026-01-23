/**
 * Job Queue Module
 * 
 * Exports job queue implementations for ant-cli.
 * 
 * Usage:
 * - Local mode: LocalJobQueue (direct spawn)
 * - Cloud mode: BullMQJobQueue (Redis-based)
 */

export { LocalJobQueue } from './LocalJobQueue';
export { BullMQJobQueue } from './BullMQJobQueue';
export type { BullMQJobQueueOptions } from './BullMQJobQueue';

// Re-export types from port
export type {
  JobQueuePort,
  JobPayload,
  JobProgress,
  JobExecutionResult,
  JobQueueStatusValue
} from '../../core/ports/queue';
