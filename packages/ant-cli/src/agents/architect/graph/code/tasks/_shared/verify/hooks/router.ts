/**
 * `_shared/verify/hooks/router` — TaskRouterHook.routeAfterDone shared by every
 * verification responsibility holder.
 *
 * Returns:
 *   - `'checkTaskStatus'` — verify-mode is complete (no fix plan to apply)
 *   - `'plan'`            — re-enter plan to re-diagnose / fan out fixes
 *   - `null`              — hook declines; router continues with default
 *
 * Decision tree (post plan §5.4 / §5.6):
 *   1. Empty planText → checkTaskStatus (diagnostic phase produced no
 *      remediation; treated as success / no fixes needed).
 *   2. Otherwise → plan (re-diagnose or apply remediation). Termination
 *      for genuinely stuck cycles is owned by `batch_cycle_limit` (10) +
 *      recursionLimit + orchestrator_fail_limit.
 *
 * R2 — depends only on the graph state shape.
 */

import type { ArchitectGraphState } from '../../../../state';
import { requiresVerification } from '../predicate';
import { getExecutionLogger } from '../../../../../../../../core/utils/executionLogger';

export function routeAfterDone(state: ArchitectGraphState): string | null {
  const hasPlan = !!state.planText?.trim();
  const planTextLen = state.planText?.length ?? 0;

  const emitDecision = (step: 1 | 2, decision: string): void => {
    const featurePath = state.context?.featurePath;
    const jobId = state._httpJobId;
    if (!featurePath || !jobId) return;
    // Static import + synchronous writeQueue update — see executionLogger
    // contract (vast-curling-perch C-3 RCA) for why dynamic import is
    // banned at every fire site.
    void getExecutionLogger({ featurePath, jobId, jobType: 'code' })
      .logRouteDecision(state.currentTask?.id, {
        router: 'routeAfterDone',
        decision,
        inputs: {
          step,
          hasPlan,
          planTextLen,
          requiresVerification: requiresVerification(state.currentTask),
          taskType: state.currentTask?.type,
        },
      })
      .catch(() => { /* non-blocking */ });
  };

  // Step 1: Empty planText → diagnostic phase decided no fixes are needed.
  if (!hasPlan) {
    emitDecision(1, 'checkTaskStatus');
    return 'checkTaskStatus';
  }

  // Step 2: Plan present → re-enter plan to apply / fan out fixes.
  emitDecision(2, 'plan');
  return 'plan';
}
