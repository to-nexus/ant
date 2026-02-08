import { DesignGraphState } from "../state";

/**
 * Plan Node
 * Manages task queue - pops next task, starts timing, updates Kanban
 * NO LLM calls - docGen handles all document generation
 */
export async function plan(state: DesignGraphState) {

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
      const { resetTaskTokenUsage } = await import('../../common/llmHelpers');
      resetTaskTokenUsage(state as any);
      
      // ✅ CRITICAL: Update Kanban snapshot when task starts
      if (state._httpJobId && state.deps?.kanbanUpdate) {
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
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'plan', taskInfo);
  }

  console.log(`\n✅ [Plan] Task prepared for execution`);
  console.log(`   Task: ${currentTask?.name}`);
  console.log(`   Next node: docGen will generate document\n`);
  
  return { ...state, currentTask };
}
