import { ArchitectGraphState } from "../state";
import { saveCheckpoint } from "./checkpoint";

/**
 * Modify Tasks Node
 * 
 * Responsibilities:
 * 1. Apply LLM's suggested task modifications
 * 2. Remove or adjust specific tasks from queue
 * 3. Save checkpoint
 * 
 * Note: Currently implements REMOVAL of tasks.
 * Future: Could expand to task editing/splitting.
 */
export async function modifyTasks(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'modifyTasks',
      taskInfo,
      undefined,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  console.log('\n🔧 [ModifyTasks] Applying task modifications...');
  
  const tasksToModify = state.tasksToModify || [];
  const taskQueue = state.taskQueue;
  
  if (!taskQueue) {
    console.warn('⚠️  [ModifyTasks] No task queue found, skipping modifications\n');
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'modifyTasks');
    }
    
    return state;
  }
  
  if (tasksToModify.length === 0) {
    console.log('   No tasks to modify specified\n');
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'modifyTasks');
    }
    
    return state;
  }
  
  // Get all tasks for manipulation
  const allTasks = taskQueue.getAll();
  const initialCount = allTasks.length;
  
  console.log(`   Tasks to remove: ${tasksToModify.join(', ')}`);
  
  // Filter out tasks that should be removed
  const modifiedTasks = allTasks.filter(task => !tasksToModify.includes(task.id));
  const removedCount = initialCount - modifiedTasks.length;
  
  if (removedCount === 0) {
    console.log('   ⚠️  No matching tasks found to remove');
    console.log(`   Available task IDs: ${allTasks.map(t => t.id).join(', ')}\n`);
  } else {
    console.log(`   ✅ Removed ${removedCount} task(s) from queue`);
    console.log(`   Remaining: ${modifiedTasks.length} tasks\n`);
  }
  
  // Rebuild task queue with modified tasks
  const newTaskQueue = new (taskQueue.constructor as any)();
  modifiedTasks.forEach(task => newTaskQueue.push(task));
  
  // Update featureTasks map
  const featureTasks = state.featureTasks || new Map();
  tasksToModify.forEach(taskId => {
    if (featureTasks.has(taskId)) {
      featureTasks.delete(taskId);
    }
  });
  
  const updatedState: ArchitectGraphState = {
    ...state,
    taskQueue: newTaskQueue,
    featureTasks
  };
  
  // Save checkpoint
  if (state.deps?.session && state.context.featureFolder) {
    try {
      await saveCheckpoint(updatedState);
      console.log(`💾 [ModifyTasks] Checkpoint saved (${newTaskQueue.size()} tasks)\n`);
    } catch (error) {
      console.warn(`⚠️  [ModifyTasks] Failed to save checkpoint:`, error);
    }
  }
  
  // Update live task queue
  if (state._httpJobId) {
    const completedTasks = state.completedTasksDetails || [];
    const queueTasks = newTaskQueue.getAll();
    
    if (state.deps?.kanbanUpdate) {
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        state.currentTask || null,
        queueTasks,
        completedTasks
      );
      console.log(`📋 [ModifyTasks] Task queue updated → Kanban board\n`);
    }
  }
  
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'modifyTasks');
  }
  
  return updatedState;
}

