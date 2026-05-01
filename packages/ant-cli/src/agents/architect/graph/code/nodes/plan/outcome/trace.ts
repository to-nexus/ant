import type { ArchitectGraphState } from '../../../state';
import type { CodeTask } from '../../../../../types/task';
import { logPrompt } from '../../../../../../../core/utils/promptLogger';

export interface PlanFinalizeTraceInput {
  callSite: 'plan-index' | 'plan-llm-overlimit' | 'plan-llm-toolloop';
  preSplitPlanText: string;
  planText: string;
  batchSplitOccurred: boolean;
  diagnosticPass?: boolean;
  emptyImplShortCircuit: boolean;
  isRemediationTask: boolean;
  decision: 'done' | 'execute';
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

  const session = state.verification;

  import('../../../../../../../core/utils/executionLogger').then(({ getExecutionLogger }) => {
    const logger = getExecutionLogger({ featurePath, jobId, jobType: 'code' });
    return logger.logPlanFinalize(nextTask.id, {
      callSite: input.callSite,
      planTextLen: input.planText.length,
      preSplitPlanTextLen: input.preSplitPlanText.length,
      batchSplitOccurred: input.batchSplitOccurred,
      diagnosticPass: input.diagnosticPass,
      emptyImplShortCircuit: input.emptyImplShortCircuit,
      isRemediationTask: input.isRemediationTask,
      sessionIsComplete: session?.isComplete(),
      sessionPassed: session?.passed(),
      sessionRequired: session?.required(),
      sessionAttempts: session?.attempts(),
      decision: input.decision,
    });
  }).catch(() => { /* non-blocking */ });

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
      sessionIsComplete: session?.isComplete(),
    },
    responseBody: input.planText,
  }).catch(() => { /* non-blocking */ });
}
