import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
import { isVerifyModeActive } from '../../../tasks/_shared/verify';
import type { PlanEntryContext } from '../entry';

/**
 * STEP 0.5 — resume an interrupted task without regenerating its plan.
 * Returns null when conditions don't hold.
 *
 * Hand-off declares `_activePhase: 'execute'` explicitly; inheriting from
 * `state` (which would be `'plan'` after `handleToolLoopReentry`) would
 * misroute `tool_result` blocks. `llmResponse` is also cleared so the
 * pure `planRouter` predicate cannot pick up a stale `tool_use`/`done`
 * flag from the prior tool-loop turn.
 *
 * **Verify-mode invariant** (vast-curling-perch follow-up): tasks in
 * verify-mode (`isVerifyModeActive(state) === true`) MUST always re-run
 * gates via the plan-tool-loop on fresh entry. Skipping the loop because
 * a stale `state.planText` survived from a snapshot would let a previous
 * cycle's diagnostic plan re-fire as if it were freshly emitted —
 * defeating the always-fan-out contract. Today the conditions don't fire
 * for the Path A re-queue (TaskWorker forces `task.interrupted=false`
 * before graph.invoke and the snapshot's planText is `''`), but the gate
 * is hard-coded as a regression guard so a future change to either
 * invariant cannot silently bypass verification.
 */
export async function maybeResumeInterrupted(
  state: ArchitectGraphState,
  entry: PlanEntryContext,
  workflowExit: (state: ArchitectGraphState) => Promise<void>,
): Promise<ArchitectGraphState | null> {
  const { nextTask, isRetry } = entry;
  if (isVerifyModeActive(state)) return null;
  const canSkipPlan = (
    !isRetry &&
    nextTask.interrupted === true &&
    state.planText && state.planText.length > 50
  );
  if (!canSkipPlan) return null;

  console.log(`\n⚡ [Plan] Resuming interrupted task "${nextTask.name}" with existing planText (${state.planText!.length} chars)`);
  console.log(`   Skipping: keywords, RAG, planText generation`);
  console.log(`   Conversations: ${getConv(state.conversations, CONV_KEYS.NODE_EXECUTE).length} execute messages preserved`);

  await workflowExit(state);
  return {
    ...state,
    currentTask: nextTask,
    planText: state.planText,
    retries: 0,
    completedTasksDetails: state.completedTasksDetails || [],
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
    workspaceConfig: state.workspaceConfig,
    _activePhase: 'execute' as const,
    llmResponse: { done: false, textResponse: '', thinking: '', toolCalls: [] },
  };
}
