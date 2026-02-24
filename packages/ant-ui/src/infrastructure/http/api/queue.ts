import type { TaskTiming } from '@ant/shared';
import { API_BASE, apiGet } from './client';

export interface QueueStatus {
  currentTask: {
    name: string;
    type: string;
    status: string;
    timing?: TaskTiming;
  } | null;
  queue: Array<{
    name: string;
    type: string;
    status: string;
    timing?: TaskTiming;
  }>;
  totalRemaining: number;
  estimatingMessage?: string | null;
}

export interface QueuePositionInfo {
  status: string;
  position: number | null;
  totalWaiting: number;
  estimatedWaitMs?: number;
  /** Redis job status — set when the job exists in Redis (survives BullMQ cleanup) */
  redisStatus?: string;
}

export function fetchQueueStatus(jobId: string): Promise<QueueStatus> {
  return apiGet(`${API_BASE()}/tasks/${encodeURIComponent(jobId)}/queue`);
}

export function fetchQueuePosition(jobId: string): Promise<QueuePositionInfo> {
  return apiGet<QueuePositionInfo>(
    `${API_BASE()}/jobs/${encodeURIComponent(jobId)}/queue-position`,
  ).catch(() => ({ status: 'unknown', position: null, totalWaiting: 0 }));
}
