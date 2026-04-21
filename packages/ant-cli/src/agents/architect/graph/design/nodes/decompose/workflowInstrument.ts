/**
 * Workflow SSE instrumentation for design decompose node entry/exit.
 */

import type { DesignGraphState } from "../../state";
import { extractLLMInfo } from "../../../../../../core/ports/workflow";

export async function enterDecomposeNode(state: DesignGraphState): Promise<void> {
  state.recursionCount = (state.recursionCount || 0) + 1;

  if (!state.deps?.workflowUpdate || !state._httpJobId) return;
  const taskInfo = state.currentTask
    ? {
        id: state.currentTask.id,
        name: state.currentTask.name,
        type: state.currentTask.type,
        description: state.currentTask.description,
        priority: state.currentTask.priority,
      }
    : undefined;
  await state.deps.workflowUpdate.enterNode(
    state._httpJobId,
    'decompose',
    0,
    taskInfo,
    state.deps?.llm ? extractLLMInfo(state.deps.llm) : undefined,
    state.recursionCount,
    state.recursionLimit,
  );
}

export async function exitDecomposeNode(state: DesignGraphState): Promise<void> {
  if (!state.deps?.workflowUpdate || !state._httpJobId) return;
  await state.deps.workflowUpdate.exitNode(state._httpJobId, 'decompose', 0);
}
