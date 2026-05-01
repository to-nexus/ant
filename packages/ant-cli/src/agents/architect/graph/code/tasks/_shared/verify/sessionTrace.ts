// Stage 0 — wraps a Session mutation and emits a before/after snapshot
// diff to log-{job}.json. Keeps Session.ts logger-unaware (R2).

import type { ArchitectGraphState } from '../../../state';
import type { VerificationSession } from './Session';

export type SessionMutationKind =
  | 'onCommand'
  | 'onFileChanged'
  | 'onBatchSplit'
  | 'onPlanApplied'
  | 'onPlanEntry'
  | 'markInstallNeeded';

interface SnapshotProjection {
  passed: string[];
  required: string[];
  attempts: number;
  planHistoryLength: number;
  batchSplitCount: number;
}

function projectSnapshot(session: VerificationSession | undefined): SnapshotProjection {
  if (!session) {
    return { passed: [], required: [], attempts: 0, planHistoryLength: 0, batchSplitCount: 0 };
  }
  const snap = session.snapshot();
  return {
    passed: [...(snap.passed ?? [])],
    required: [...(snap.required ?? [])],
    attempts: snap.attempts ?? 0,
    planHistoryLength: (snap.planHistoryHashes ?? []).length,
    batchSplitCount: snap.batchSplitCount ?? 0,
  };
}

export function traceSession<T>(
  state: ArchitectGraphState,
  event: SessionMutationKind,
  mutation: () => T,
  extra?: Record<string, any>,
): T {
  const before = projectSnapshot(state.verification);
  const result = mutation();
  const after = projectSnapshot(state.verification);

  const featurePath = state.context?.featurePath;
  const jobId = state._httpJobId;
  const taskId = state.currentTask?.id;
  if (featurePath && jobId && taskId) {
    import('../../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
      const logger = getExecutionLogger({ featurePath, jobId, jobType: 'code' });
      return logger.logVerificationSessionChange(taskId, { event, before, after, extra });
    }).catch(() => { /* non-blocking */ });
  }
  return result;
}
