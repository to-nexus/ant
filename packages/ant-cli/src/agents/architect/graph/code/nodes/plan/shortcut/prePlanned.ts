import { CONV_KEYS } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { computeBudgetFromPlanText } from '../outcome/budget';
import { hooksForTaskType } from '../../../tasks/_shared/registry';
import { clearForTaskBoundary } from '../../../tasks/_shared/verify/markVerifyEntered';
import type { PlanEntryContext } from '../entry';

/**
 * STEP 0.6 — pre-planned batch-split sub-task (error / test-code).
 *
 * Both types are drop-and-replace sub-tasks: parent is gone and the
 * sub-task owns a fixed scope. Forcing them through plan-phase tool-loop
 * on retry would re-run diagnostics the parent distilled (cascade
 * regression) or lose the slice boundary (test-code).
 */
export async function maybePrePlannedFastPath(
  state: ArchitectGraphState,
  entry: PlanEntryContext,
  workflowExit: (state: ArchitectGraphState) => Promise<void>,
): Promise<ArchitectGraphState | null> {
  const { nextTask, isRetry } = entry;
  const prePlanText = (nextTask as CodeTask).prePlanText;
  const isBatchSplitSub =
    hooksForTaskType(nextTask.type)?.plan?.acceptsPrePlanText === true;
  const hasPrePlanText =
    prePlanText != null &&
    prePlanText.length > 50 &&
    (!isRetry || isBatchSplitSub);

  if (!hasPrePlanText) return null;

  console.log(`\n⚡ [Plan] Pre-planned ${nextTask.type} task "${nextTask.name}" — using prePlanText (${prePlanText!.length} chars)`);
  console.log(`   Skipping: keywords, RAG, diagnostic tool loop, planText generation`);

  await workflowExit(state);
  return {
    ...state,
    currentTask: nextTask,
    planText: prePlanText!,
    _executeBudget: computeBudgetFromPlanText(prePlanText!),
    retries: 0,
    completedTasksDetails: state.completedTasksDetails || [],
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
    workspaceConfig: state.workspaceConfig,
    conversations: { [CONV_KEYS.NODE_EXECUTE]: [] },
    _activePhase: 'execute' as const,
    // A preceding verification session must not leak into the sub-task;
    // test-code never owns a session anyway.
    ...clearForTaskBoundary(),
  };
}
