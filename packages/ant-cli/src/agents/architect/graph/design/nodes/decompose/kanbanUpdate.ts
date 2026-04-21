/**
 * Kanban task-queue broadcast for design decompose.
 *
 * Decompose-phase-local helper — only the four decompose files consume it
 * (docGen/revise/learn use `state.deps.kanbanUpdate.updateTaskQueue(...)`
 * directly with different signatures). Kept inside `nodes/decompose/`
 * per NODE_GRAPH_LAYOUT §2.2; promote to `nodes/_common/` only when a
 * second phase actually imports it.
 */

import type { DesignGraphState } from "../../state";
import type { DesignTask } from "../../../../types/task";

export function updateKanban(
  state: DesignGraphState,
  currentTask: DesignTask | null,
  queue: DesignTask[],
  completed: any[] = [],
  recursionCount = 0,
): void {
  if (!state._httpJobId || !state.deps?.kanbanUpdate) return;
  state.deps.kanbanUpdate.updateTaskQueue(
    state._httpJobId,
    currentTask,
    queue,
    completed,
    recursionCount,
    undefined,
  );
}
