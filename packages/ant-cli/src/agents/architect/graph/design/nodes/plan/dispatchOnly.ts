/**
 * Dispatch-only fallback for the design plan node.
 *
 * Preserves the legacy `plan.ts` task-pop / timing / kanban / workflow
 * lifecycle for intent groups that do NOT (yet) participate in the
 * plan-LLM pipeline (`design-ui`, `design-game-art`).
 *
 * The intent-group guard in `index.ts` calls into this when no LLM
 * exploration is appropriate; downstream the design graph still routes
 * `plan → docGen` for those intents through the dispatcher's return
 * shape.
 */

import { DesignGraphState } from '../../state';
import { getExecutionLogger } from '../../../../../../core/utils/executionLogger';

export async function dispatchOnly(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  state.recursionCount = (state.recursionCount || 0) + 1;

  let currentTask = state.currentTask;

  if (state.taskQueue && !currentTask) {
    const nextTask = state.taskQueue.pop();
    if (nextTask) {
      currentTask = nextTask;
      console.log(`\n📋 Processing task: "${nextTask.name}"`);
      console.log(`   Priority: ${nextTask.priority}`);
      console.log(`   Description: ${nextTask.description}\n`);

      const { TaskTimingHelper } = await import('../../../code/state');
      console.log(`⏱️  Starting timer for task: ${currentTask.name}`);
      currentTask = TaskTimingHelper.startTask(currentTask);

      const { resetTaskTokenUsage } = await import('../../../../../common/graph/llmHelpers');
      resetTaskTokenUsage(state);

      const _workerId = state.workerId;
      const isWorkerContext = _workerId !== undefined && _workerId !== null;
      if (!isWorkerContext && state._httpJobId && state.deps?.kanbanUpdate) {
        console.log(`\n🔥 [Plan/dispatch] Updating Kanban → task started`);
        console.log(`   Current: ${currentTask.name}`);
        console.log(`   Remaining in queue: ${state.taskQueue.size()}\n`);

        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpJobId,
          currentTask,
          state.taskQueue.getAll(),
          state.completedTasksDetails || [],
        );
      }

      const { saveTaskStartCheckpoint } = await import('../../session/checkpoint');
      await saveTaskStartCheckpoint(state, { currentTask });
    } else {
      console.log('⚠️  No task to execute');
      return state;
    }
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = currentTask ? {
      id: currentTask.id,
      name: currentTask.name,
      type: currentTask.type,
      description: currentTask.description,
      priority: currentTask.priority,
    } : undefined;

    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'plan', state.workerId ?? 0, taskInfo,
      undefined, state.recursionCount, state.recursionLimit,
    );
  }

  if (currentTask && state.context?.featurePath && state._httpJobId) {
    try {
      const execLogger = getExecutionLogger({
        featurePath: state.context.featurePath,
        jobId: state._httpJobId,
        jobType: 'design',
      });
      await execLogger.logTaskStart(currentTask.id, {
        taskName: currentTask.name,
        taskType: currentTask.type || 'doc',
        priority: currentTask.priority || 0,
        isParallel: false,
        parallelGroup: (currentTask as any).parallelGroup,
      });

      // Phase event so the operator can distinguish "plan-LLM ran and
      // sealed a <plan>" (design-plan-sealed) from "plan-LLM was
      // skipped because the intent group is not yet plan-LLM enabled"
      // (design-plan-dispatch-only). Both paths reach docGen but only
      // the former injects a sealed plan into the runtime context.
      void execLogger
        .logPhaseComplete({
          phase: 'design-plan-dispatch-only',
          elapsedMs: 0,
          details: {
            taskId: currentTask.id,
            taskName: currentTask.name,
            taskType: currentTask.type || 'doc',
            intentGroup: state.resolvedAction?.intentGroup,
            reason: 'intent-group-not-plan-llm-enabled',
            recursionCount: state.recursionCount,
          },
        })
        .catch(() => { /* non-blocking */ });
    } catch (_) { /* non-critical */ }
  }

  console.log(`\n✅ [Plan/dispatch] Task prepared for execution`);
  console.log(`   Task: ${currentTask?.name}`);
  console.log(`   IntentGroup: ${state.resolvedAction?.intentGroup ?? 'unknown'} (plan-LLM skipped)`);
  console.log(`   Next node: docGen will generate document\n`);

  return { ...state, currentTask };
}
