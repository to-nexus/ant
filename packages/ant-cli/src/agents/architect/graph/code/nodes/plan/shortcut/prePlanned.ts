import { CONV_KEYS } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { hooksForTaskType } from '../../../tasks/_shared/registry';
import { clearForTaskBoundary } from '../../../tasks/_shared/verify/markVerifyEntered';
import { isVerifyModeActive } from '../../../tasks/_shared/verify';
import type { PlanEntryContext } from '../entry';

/**
 * STEP 0.6 — error remediation sub-task identity-shortcut.
 *
 * Only `error` (drop-and-replace sub-tasks from verification's diagnostic
 * batch-split or from a prior error parent) publishes
 * `acceptsPrePlanText:true`. The diagnostic IS the plan — verification
 * produced a fresh failure signal (compiler / test / lint output) and
 * forcing a plan-tool-loop would re-derive what was just observed
 * (cascade regression).
 *
 * `test-code` and `feature` batch-split sub-tasks DO enter the plan-tool-
 * loop (no shortcut). Their `prePlanText` is surfaced as plan-tool-loop
 * INPUT via `nodes/plan/injections/parent-pre-plan.md` so the LLM verifies
 * the parent's decision against actual sibling outputs before emitting
 * `planText`. See `nodes/plan/llm/prompt.ts` for the var wiring.
 *
 * **Verify-mode invariant** (vast-curling-perch follow-up): symmetric
 * with `maybeResumeInterrupted`. A task that has entered verify-mode
 * MUST re-run gates via the plan-tool-loop; pre-plan injection would
 * skip the diagnostic gate entirely. The `acceptsPrePlanText` flag
 * already gates dispatch to `error` only (verification doesn't publish
 * it), so today this guard is defence-in-depth — but locking the
 * invariant here protects against a future bundle accidentally
 * publishing `acceptsPrePlanText:true` on a verify-mode-eligible task.
 */
export async function maybePrePlannedFastPath(
  state: ArchitectGraphState,
  entry: PlanEntryContext,
  workflowExit: (state: ArchitectGraphState) => Promise<void>,
): Promise<ArchitectGraphState | null> {
  const { nextTask } = entry;
  if (isVerifyModeActive(state)) return null;
  const prePlanText = (nextTask as CodeTask).prePlanText;
  const isBatchSplitSub =
    hooksForTaskType(nextTask.type)?.plan?.acceptsPrePlanText === true;
  // Shortcut fires only when the bundle explicitly opts in via
  // `acceptsPrePlanText:true` (currently `error` only). Other batch-split
  // sub-types carry `prePlanText` but MUST enter the plan-tool-loop so the
  // LLM verifies the parent's predicted exports against actual sibling
  // outputs (see `nodes/plan/injections/parent-pre-plan.md`).
  const hasPrePlanText =
    prePlanText != null && prePlanText.length > 50 && isBatchSplitSub;

  if (!hasPrePlanText) return null;

  console.log(`\n⚡ [Plan] Pre-planned ${nextTask.type} task "${nextTask.name}" — using prePlanText (${prePlanText!.length} chars)`);
  console.log(`   Skipping: keywords, RAG, diagnostic tool loop, planText generation`);

  await workflowExit(state);
  return {
    ...state,
    currentTask: nextTask,
    planText: prePlanText!,
    retries: 0,
    completedTasksDetails: state.completedTasksDetails || [],
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
    workspaceConfig: state.workspaceConfig,
    conversations: { [CONV_KEYS.NODE_EXECUTE]: [] },
    _activePhase: 'execute' as const,
    // A preceding verification session must not leak into the error
    // sub-task (error never owns a session anyway).
    ...clearForTaskBoundary(),
  };
}
