import { CONV_KEYS, getConv } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
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
 */
export async function maybeResumeInterrupted(
  state: ArchitectGraphState,
  entry: PlanEntryContext,
  workflowExit: (state: ArchitectGraphState) => Promise<void>,
): Promise<ArchitectGraphState | null> {
  const { nextTask, isRetry } = entry;
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
