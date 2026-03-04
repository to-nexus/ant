import { DesignGraphState } from "../state";

/**
 * Plan Node
 * Manages task queue - pops next task, starts timing, updates Kanban
 * NO LLM calls - docGen handles all document generation
 */
export async function plan(state: DesignGraphState) {
  // ✅ Increment recursion count (track node execution for UI gauge)
  state.recursionCount = (state.recursionCount || 0) + 1;

  // ✅ CRITICAL: Get next task BEFORE enterNode
  // This ensures enterNode is called with correct taskInfo
  let currentTask = state.currentTask;
  
  if (state.taskQueue && !currentTask) {
    const nextTask = state.taskQueue.pop();
    if (nextTask) {
      currentTask = nextTask;
      console.log(`\n📋 Processing task: "${nextTask.name}"`);
      console.log(`   Priority: ${nextTask.priority}`);
      console.log(`   Description: ${nextTask.description}\n`);
      
      // ✨ Start timing for the task
      const { TaskTimingHelper } = await import('../../code/state');
      console.log(`⏱️  Starting timer for task: ${currentTask.name}`);
      currentTask = TaskTimingHelper.startTask(currentTask);
      
      // ✅ Reset task-level token usage tracking
      const { resetTaskTokenUsage } = await import('../../../../common/graph/llmHelpers');
      resetTaskTokenUsage(state as any);
      
      // ✅ CRITICAL: Update Kanban snapshot when task starts
      // Skip in worker context — TaskOrchestrator handles kanban for parallel mode
      // (per-worker kanban would overwrite multi-task inProgress with just this worker's task)
      const _workerId = (state as any).workerId;
      const isWorkerContext = _workerId !== undefined && _workerId !== null;
      if (!isWorkerContext && state._httpJobId && state.deps?.kanbanUpdate) {
        console.log(`\n🔥 [Plan] Updating Kanban → task started`);
        console.log(`   Current: ${currentTask.name}`);
        console.log(`   Remaining in queue: ${state.taskQueue.size()}\n`);
        
        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpJobId,
          currentTask,                    // ✅ Show current task as in-progress
          state.taskQueue.getAll(),      // ✅ Remaining queue
          state.completedTasksDetails || []
        );
      }
      
      // ✅ CRITICAL: Save checkpoint after task started so session has correct currentTask
      // Without this, manual cancel during docGen can't find the in-progress task
      if (state.deps?.session && state.context?.featureFolder) {
        try {
          // Import from code state (shared checkpoint logic)
          const { saveCheckpoint } = await import('../../code/nodes/checkpoint');
          await saveCheckpoint({
            ...state,
            currentTask
          } as any);
        } catch (err) {
          console.warn(`⚠️  [Plan] Failed to save task-start checkpoint: ${err}`);
        }
      }
    } else {
      console.log('⚠️  No task to execute');
      return state;
    }
  }
  
  // ✅ Workflow instrumentation: Enter node AFTER currentTask is set
  // ✅ CRITICAL: await to ensure workflow SSE is sent before continuing
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = currentTask ? {
      id: currentTask.id,
      name: currentTask.name,
      type: currentTask.type,
      description: currentTask.description,
      priority: currentTask.priority
    } : undefined;
    
    // ✅ Note: No llmInfo needed - plan node doesn't call LLM
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'plan', (state as any).workerId ?? 0, taskInfo,
      undefined, state.recursionCount, state.recursionLimit
    );
  }

  // ✅ Log task_start to debug/logs/
  if (currentTask && state.context?.featurePath && state._httpJobId) {
    try {
      const { getExecutionLogger } = await import('../../../../../core/utils/executionLogger');
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
    } catch (_) { /* non-critical */ }
  }

  console.log(`\n✅ [Plan] Task prepared for execution`);
  console.log(`   Task: ${currentTask?.name}`);
  console.log(`   Next node: docGen will generate document\n`);
  
  return { ...state, currentTask };
}
