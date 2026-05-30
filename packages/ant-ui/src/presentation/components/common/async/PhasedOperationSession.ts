/**
 * Generic session shape for any phased-operation FE workflow (project
 * deletion, feature deletion, future phased flows).
 *
 * Domain slices reuse this shape and extend the non-idle variants with
 * domain identifiers (projectId, featureName, ...) via intersection so
 * the generic `<PhasedOperationPanel>` can render the body without
 * knowing the domain.
 *
 *   type ProjectDeletionSession =
 *     | Extract<PhasedOperationSession<ProjectDeletionPhase>, { kind: 'idle' }>
 *     | (Exclude<PhasedOperationSession<ProjectDeletionPhase>, { kind: 'idle' }>
 *         & { projectId: string });
 */

export type PhasedOperationHistoryStatus = 'complete' | 'failed';

export interface PhasedOperationPhaseSnapshot<TPhase extends string> {
  phase: TPhase;
  status: PhasedOperationHistoryStatus;
}

export type PhasedOperationSession<TPhase extends string> =
  | { kind: 'idle' }
  | {
      kind: 'deleting';
      phase: TPhase | null;
      startedAt: number;
      phaseHistory: PhasedOperationPhaseSnapshot<TPhase>[];
    }
  | { kind: 'completed'; completedAt: number }
  | {
      kind: 'failed';
      stage: TPhase;
      message: string;
      hint?: string;
      leftovers?: string[];
      canForceCleanup: boolean;
      correlationId: string;
    };

/**
 * Derive the failed phase from a deleting-session's history (or directly
 * from a failed session). SSOT helper shared by every domain slice's
 * `select<Domain>FailedPhase` so the rail can render the failed step red
 * mid-cascade (force mode continues after a step's `failed` event).
 */
export function selectFailedPhase<TPhase extends string>(
  session: PhasedOperationSession<TPhase>,
): TPhase | null {
  if (session.kind === 'deleting') {
    const failed = session.phaseHistory.find((p) => p.status === 'failed');
    return failed ? failed.phase : null;
  }
  if (session.kind === 'failed') return session.stage;
  return null;
}
