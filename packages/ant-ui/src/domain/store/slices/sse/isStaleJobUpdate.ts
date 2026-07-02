/**
 * Shared run-state guard for SSE handlers.
 *
 * An incoming event/kanban update is "stale" for run-state purposes when it
 * carries a jobId that differs from the job the store is currently tracking
 * (`currentJobId`). Such an update must NOT flip `isRunning` off or reassign
 * `currentJobId` — it belongs to a prior/other job whose late completion or
 * session snapshot is arriving out of order (e.g. a resume where the previous
 * turn's session is still being polled while the new job runs).
 *
 * SSOT: both `chatSseHandler` (job_status → setRunning(false)) and
 * `kanbanReducer` (session → currentJobId/isRunning clobber) gate on this one
 * predicate so their run-state transition rules cannot drift apart.
 */
export function isStaleJobUpdate(
  eventJobId: string | undefined | null,
  currentJobId: string | undefined | null,
): boolean {
  return !!(eventJobId && currentJobId && eventJobId !== currentJobId);
}
