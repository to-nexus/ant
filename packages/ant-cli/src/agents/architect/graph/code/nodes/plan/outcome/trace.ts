import type { ArchitectGraphState } from '../../../state';
import type { CodeTask } from '../../../../../types/task';
import { logPrompt } from '../../../../../../../core/utils/promptLogger';
import { getExecutionLogger } from '../../../../../../../core/utils/executionLogger';
import { requiresVerification } from '../../../tasks/_shared/verify';

/**
 * Empty-`planText` origin classifier.
 *   - 'verification-short-circuit': `requiresPlanText === false` branch
 *     (verification / doc / explain — no JSON plan body by spec).
 *   - 'tool-loop-empty': `allowsEmptyPlanShortcut` branch in the plan
 *     tool loop (LLM-judged "no diagnostics, nothing to fix").
 *   - undefined: planText is non-empty, or origin does not apply.
 */
export type PlanEmptyOrigin = 'verification-short-circuit' | 'tool-loop-empty' | undefined;

/**
 * Verify-mode dispatch axes captured at finalize time. Mirrors the
 * verify SSOT axes documented in `17-code-verification-task.md` §10.1.
 */
export interface VerifyAxisSnapshot {
  requiresVerification: boolean;
  verifyEntered: boolean;
  hasSession: boolean;
}

export interface PlanFinalizeTraceInput {
  callSite: 'plan-index' | 'plan-llm-overlimit' | 'plan-llm-toolloop';
  preSplitPlanText: string;
  planText: string;
  batchSplitOccurred: boolean;
  diagnosticPass?: boolean;
  emptyImplShortCircuit: boolean;
  isRemediationTask: boolean;
  decision: 'done' | 'execute';
  planEmptyOrigin?: PlanEmptyOrigin;
}

/**
 * Emit a `plan_finalize` event + prompt-log entry. Three call sites
 * (plan/index STEP 4, llm overlimit, llm toolloop) converge here.
 */
export function tracePlanFinalize(
  state: ArchitectGraphState,
  nextTask: CodeTask,
  input: PlanFinalizeTraceInput,
): void {
  const featurePath = state.context?.featurePath;
  const jobId = state._httpJobId;
  if (!featurePath || !jobId) return;

  const verifyAxisSnapshot: VerifyAxisSnapshot = {
    requiresVerification: requiresVerification(nextTask),
    verifyEntered: state._verifyEntered === true,
    hasSession: false,
  };

  // Static import + synchronous writeQueue update — see executionLogger
  // contract (vast-curling-perch C-3 RCA).
  void getExecutionLogger({ featurePath, jobId, jobType: 'code' })
    .logPlanFinalize(nextTask.id, {
      callSite: input.callSite,
      planTextLen: input.planText.length,
      preSplitPlanTextLen: input.preSplitPlanText.length,
      batchSplitOccurred: input.batchSplitOccurred,
      diagnosticPass: input.diagnosticPass,
      emptyImplShortCircuit: input.emptyImplShortCircuit,
      isRemediationTask: input.isRemediationTask,
      decision: input.decision,
      planEmptyOrigin: input.planEmptyOrigin,
      verifyAxisSnapshot,
    })
    .catch(() => { /* non-blocking */ });

  void logPrompt(featurePath, jobId, 'code', 'plan-finalize', input.planText.length, {
    taskId: nextTask.id,
    taskName: nextTask.name,
    injectedVariables: {
      callSite: input.callSite,
      decision: input.decision,
      batchSplitOccurred: input.batchSplitOccurred,
      diagnosticPass: input.diagnosticPass,
      emptyImplShortCircuit: input.emptyImplShortCircuit,
      preSplitPlanTextLen: input.preSplitPlanText.length,
      planEmptyOrigin: input.planEmptyOrigin,
      verifyAxisSnapshot,
    },
    responseBody: input.planText,
  }).catch(() => { /* non-blocking */ });
}
