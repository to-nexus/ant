import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { KanbanService } from '../../services';
import { logger } from '../../../../../utils/logger';

/**
 * Mark paused/running Redis jobs for a (project, feature, jobType) triple as
 * failed, and evict their in-process kanban memory. Returns the affected
 * jobIds so callers can do follow-up cleanup (e.g. debug artifact removal).
 *
 * Decoupled from session files — works even when the session.json is missing
 * or corrupted. Shared by:
 *   - Job tab X (`DELETE /session?job=...` in features.routes.ts)
 *   - Hard Reset (`POST /context/reset` in feature-log.routes.ts)
 *
 * Silent (returns []) when no stateStore is wired.
 */
export async function cleanupStaleRedisJobs(
  stateStore: StateStorePort | undefined,
  kanbanService: KanbanService | undefined,
  projectId: string,
  featureName: string,
  jobType: string,
): Promise<string[]> {
  if (!stateStore) return [];

  const jobs = await stateStore.listJobsByFeature(projectId, featureName);
  const staleJobs = jobs.filter(
    (j) => (j.status === 'paused' || j.status === 'running') && j.type === jobType,
  );

  for (const job of staleJobs) {
    await stateStore.updateJobStatus(job.jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: 'Session cleared by user',
    });
    if (kanbanService) {
      await kanbanService.clearJobMemory(job.jobId);
    }
    logger.debug(`[SessionCleanup] Marked stale job ${job.jobId} as failed (was: ${job.status})`);
  }

  return staleJobs.map((j) => j.jobId);
}

/**
 * Invalidate KanbanService's file-path cache and publish a fresh kanban
 * snapshot over the user's realtime channel so every connected tab resets
 * its view in sync.
 *
 * Silent no-op when kanbanService, stateStore, or userContext org/user are
 * missing (e.g. local-mode without auth surfaces here as missing org/user).
 */
export async function broadcastKanbanReset(
  stateStore: StateStorePort | undefined,
  kanbanService: KanbanService | undefined,
  projectId: string,
  featureName: string,
  jobType: 'code' | 'design' | 'learn' | 'plan',
  userContext: { organizationId?: string; userId?: string } | undefined,
): Promise<void> {
  if (!kanbanService || !stateStore || !userContext?.organizationId || !userContext?.userId) {
    return;
  }
  try {
    kanbanService.invalidateSessionCacheByFeature(userContext as any, projectId, featureName, jobType);
    const kanbanData = await kanbanService.getKanbanData(
      projectId,
      featureName,
      jobType,
      undefined,
      undefined,
      undefined,
      userContext as any,
    );
    const { getRealtimeBroadcastChannel } = await import(
      '../../../../../infrastructure/state/redisConstants'
    );
    const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
    await stateStore.publish(channel, {
      projectId,
      featureName,
      type: 'kanban',
      data: kanbanData,
      userContext,
    });
  } catch (err) {
    logger.warn(
      `Failed to broadcast kanban update after reset (${jobType})`,
      { component: 'SessionCleanup' },
      err,
    );
  }
}
