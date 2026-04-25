import { API_BASE, apiGet } from './client';

// `QueueStatus` / `fetchQueueStatus` were removed — they targeted a legacy
// `/tasks/:id/queue` endpoint that doesn't exist on the BE and had zero
// call sites in ant-ui.

export interface QueuePositionInfo {
  status: string;
  position: number | null;
  totalWaiting: number;
  estimatedWaitMs?: number;
  /** Redis job status — set when the job exists in Redis (survives BullMQ cleanup) */
  redisStatus?: string;
}

export function fetchQueuePosition(jobId: string): Promise<QueuePositionInfo> {
  return apiGet<QueuePositionInfo>(
    `${API_BASE()}/jobs/${encodeURIComponent(jobId)}/queue-position`,
  ).catch(() => ({ status: 'unknown', position: null, totalWaiting: 0 }));
}
