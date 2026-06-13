import type { KanbanData } from '@ant/shared';
import type { SessionRun, SessionRunStatus } from '../types/session';

/**
 * A `runs[]` entry's terminal state and completed-task count only ever move
 * forward. Returns true when an incoming snapshot write would REGRESS an
 * existing run — i.e. demote a `completed` run to a non-completed status, or
 * lower its completed-task count. That signature is a clobber from a
 * stale/earlier checkpoint re-finalizing the same jobId (plain-dimming-flock
 * RCA), never legitimate progress, so callers must refuse it.
 *
 * Shared SSOT for the monotonicity guard across every session-run writer
 * (`appendJobSnapshotToSession`, `FileSessionAdapter.addRun`).
 */
export function wouldRegressRun(
  existing: SessionRun,
  incomingStatus: SessionRunStatus | undefined,
  incomingSnapshot: KanbanData | undefined,
): boolean {
  const demotesCompleted = existing.status === 'completed' && incomingStatus !== 'completed';
  const existingCompleted = existing.kanbanSnapshot?.completed?.length ?? 0;
  const incomingCompleted = incomingSnapshot?.completed?.length ?? 0;
  const regressesProgress = incomingCompleted < existingCompleted;
  return demotesCompleted || regressesProgress;
}
