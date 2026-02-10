import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState } from "../state";
import { CodeTask } from "../../../types/task";
import { saveCheckpoint } from "./checkpoint";
import { getEstimatingLabel } from "../../../../common/graph/timing/estimatingLabels";

/**
 * Revise Node (replaces replanDecision + modifyTasks + clearStateForReplan)
 * 
 * Called when: isResume && hasTaskQueue && overrideDirective (new chat input on existing tasks)
 * 
 * Responsibilities:
 * 1. LLM decides: continue (no changes) or modify (add/remove tasks)
 * 2. If modify: immediately apply task changes to taskQueue & featureTasks
 * 3. Save checkpoint
 * 4. Always routes to → plan
 */
export async function revise(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const phaseStart = Date.now();
  
  // ✅ Node activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('revise', state._uiLocale), 'revise');
  }
  
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  const llm = state.deps?.llm as LLMClient;
  
  // ✅ Workflow tracking: enter node
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    
    const llmInfo = (llm as any)?.provider && (llm as any)?.modelName ? {
      provider: (llm as any).provider,
      model: (llm as any).modelName
    } : undefined;
    
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'revise',
      0,
      taskInfo,
      llmInfo,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  const directives = state.directives || [];
  const overrideDirective = state.overrideDirective;
  
  // If no new directive (just resume button), continue without changes
  if (!overrideDirective && directives.length < 2) {
    console.log('📋 [Revise] No new directive → CONTINUE (no task changes needed)\n');
    
    state._phaseTimings = { ...(state._phaseTimings || {}), revise: Date.now() - phaseStart };
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'revise', 0);
    }
    
    return state;
  }
  
  // New directive exists - ask LLM for decision
  const newDirective = overrideDirective || directives[0] || '';
  const originalDirective = directives.length > 1 ? directives[directives.length - 1] : (state.directive || '');
  
  console.log(`\n🔍 [Revise] Analyzing impact of new directive`);
  console.log(`   Original: "${originalDirective.substring(0, 60)}..."`);
  console.log(`   New:      "${newDirective.substring(0, 60)}..."`);
  console.log('   Analyzing...\n');
  
  try {
    const promptEngine = state.deps?.promptEngine;
    if (!promptEngine) {
      throw new Error('[Revise] PromptEngine not available');
    }
    
    // Prepare template data
    const completedCount = state.completedTasks?.length || 0;
    const remainingTasks = state.taskQueue?.getAll() || [];
    const totalTasks = completedCount + remainingTasks.length + (state.currentTask ? 1 : 0);
    
    const completedTasksList = state.completedTasksDetails?.map(t => ({
      id: t.id,
      name: t.name,
      type: t.type,
      description: t.description
    })) || [];
    
    // Generate prompt via PromptEngine
    const prompt = await promptEngine.buildRevisePrompt('code', {
      context: state.context,
      completedCount,
      totalTasks,
      currentTask: state.currentTask,
      remainingTasks: remainingTasks.map((t, idx) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        priority: t.priority,
        description: t.description,
        index: idx
      })),
      completedTasksList,
      originalDirective,
      newDirective,
      directives: directives.map((d, idx) => ({
        index: idx,
        content: d.substring(0, 200),
        isLatest: idx === 0,
        isOriginal: idx === directives.length - 1
      }))
    });
    
    console.log('🤖 [Revise] Asking LLM for decision...');
    
    const response = await llm.invoke([
      { role: 'user', content: prompt }
    ]);
    
    // Parse JSON response
    let decision: {
      action: 'continue' | 'modify';
      reason: string;
      tasksToRemove: string[];
      tasksToAdd: Array<{
        name: string;
        description: string;
        type: 'setup' | 'feature';
        priority: number;
        insertAfter?: string;
        ui?: boolean;
        uiSections?: string[];
        packages?: string[];
      }>;
    };
    
    try {
      let cleanResponse = response.trim();
      if (cleanResponse.startsWith('```json')) {
        cleanResponse = cleanResponse.replace(/```json\n?/, '').replace(/\n?```$/, '');
      } else if (cleanResponse.startsWith('```')) {
        cleanResponse = cleanResponse.replace(/```\n?/, '').replace(/\n?```$/, '');
      }
      
      decision = JSON.parse(cleanResponse);
      
      if (!['continue', 'modify'].includes(decision.action)) {
        throw new Error(`Invalid action: ${decision.action}`);
      }
      
      console.log(`\n✅ [Revise] Decision: ${decision.action.toUpperCase()}`);
      console.log(`   Reason: ${decision.reason}`);
      
    } catch (parseError) {
      console.error('❌ [Revise] Failed to parse LLM response as JSON');
      console.error('   Response:', response.substring(0, 200));
      console.log('   Falling back to CONTINUE (safe default)\n');
      
      decision = {
        action: 'continue',
        reason: 'Failed to parse LLM decision - defaulting to continue',
        tasksToRemove: [],
        tasksToAdd: []
      };
    }
    
    // Apply changes if action is 'modify'
    if (decision.action === 'modify') {
      // ✅ Check if the interrupted task (front of queue) is affected by modifications
      const interruptedTaskId = state.taskQueue?.peek()?.id;
      const isInterruptedTaskAffected = interruptedTaskId
        ? decision.tasksToRemove.includes(interruptedTaskId)
        : false;
      
      const updatedState = applyTaskModifications(state, decision);
      
      // Update directive with the new one
      if (overrideDirective) {
        updatedState.directive = overrideDirective;
      }
      
      // ✅ Clear planText + conversationHistory only if the interrupted task itself was affected
      // If only other tasks were added/removed, the current task's plan and progress are still valid
      if (isInterruptedTaskAffected) {
        console.log(`   🔄 Interrupted task "${interruptedTaskId}" was affected → clearing planText + conversationHistory`);
        updatedState.planText = '';
        updatedState.conversationHistory = [];
      } else {
        console.log(`   ✅ Interrupted task not affected → preserving planText + conversationHistory`);
      }
      
      // Save checkpoint
      if (state.deps?.session && state.context.featureFolder) {
        try {
          await saveCheckpoint(updatedState);
          console.log(`💾 [Revise] Checkpoint saved\n`);
        } catch (error) {
          console.warn(`⚠️  [Revise] Failed to save checkpoint:`, error);
        }
      }
      
      // Update Kanban
      if (state.deps?.kanbanUpdate && state._httpJobId && updatedState.taskQueue) {
        const queueTasks = updatedState.taskQueue.getAll();
        const completedTasks = updatedState.completedTasksDetails || [];
        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpJobId,
          updatedState.currentTask || null,
          queueTasks,
          completedTasks
        );
        console.log(`📋 [Revise] Task queue updated → Kanban board\n`);
      }
      
      updatedState._phaseTimings = { ...(updatedState._phaseTimings || {}), revise: Date.now() - phaseStart };
      
      if (state.deps?.workflowUpdate && state._httpJobId) {
        state.deps.workflowUpdate.exitNode(state._httpJobId, 'revise', 0);
      }
      
      return updatedState;
    }
    
    // Action is 'continue' - no changes needed
    // But still update directive if new one provided
    const result = { ...state };
    if (overrideDirective) {
      result.directive = overrideDirective;
    }
    result._phaseTimings = { ...(result._phaseTimings || {}), revise: Date.now() - phaseStart };
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'revise', 0);
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ [Revise] Error during revision:', error);
    console.log('   Falling back to CONTINUE (safe default)\n');
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'revise', 0);
    }
    
    // ✅ CRITICAL: Still update directive even on error
    // Without this, the new directive is lost and subsequent prompts use the old one
    const result = { ...state };
    if (overrideDirective) {
      result.directive = overrideDirective;
    }
    result._phaseTimings = { ...(result._phaseTimings || {}), revise: Date.now() - phaseStart };
    return result;
  }
}

/**
 * Apply task modifications (remove + add) to the task queue
 */
function applyTaskModifications(
  state: ArchitectGraphState,
  decision: {
    tasksToRemove: string[];
    tasksToAdd: Array<{
      name: string;
      description: string;
      type: 'setup' | 'feature';
      priority: number;
      insertAfter?: string;
      ui?: boolean;
      uiSections?: string[];
      packages?: string[];
    }>;
  }
): ArchitectGraphState {
  const taskQueue = state.taskQueue;
  if (!taskQueue) {
    console.warn('⚠️  [Revise] No task queue found, skipping modifications');
    return state;
  }
  
  const allTasks = taskQueue.getAll();
  const initialCount = allTasks.length;
  
  // 1. Remove tasks
  const tasksToRemove = decision.tasksToRemove || [];
  let modifiedTasks = allTasks;
  
  if (tasksToRemove.length > 0) {
    modifiedTasks = allTasks.filter(task => !tasksToRemove.includes(task.id));
    const removedCount = initialCount - modifiedTasks.length;
    console.log(`   🗑️  Removed ${removedCount} task(s): ${tasksToRemove.join(', ')}`);
  }
  
  // 2. Add new tasks
  const tasksToAdd = decision.tasksToAdd || [];
  const newTasks: CodeTask[] = [];
  
  if (tasksToAdd.length > 0) {
    for (const taskDef of tasksToAdd) {
      const newTask: CodeTask = {
        id: `revised-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        name: taskDef.name,
        description: taskDef.description,
        type: taskDef.type,
        priority: taskDef.priority,
        ui: taskDef.ui ?? false,
        ...(taskDef.uiSections && { uiSections: taskDef.uiSections }),
        ...(taskDef.packages && { packages: taskDef.packages }),
      };
      newTasks.push(newTask);
      console.log(`   ➕ Added task: "${newTask.name}" (P${newTask.priority}, packages=${taskDef.packages?.join(',') || 'none'}, ui=${newTask.ui})`);
    }
  }
  
  // 3. Rebuild task queue
  const TaskQueueClass = taskQueue.constructor as any;
  const newTaskQueue = new TaskQueueClass();
  
  // Add remaining tasks
  modifiedTasks.forEach(task => newTaskQueue.push(task));
  
  // Add new tasks (priority-based insertion is handled by TaskQueue itself)
  newTasks.forEach(task => newTaskQueue.push(task));
  
  // 4. Update featureTasks map
  const featureTasks = new Map(state.featureTasks || new Map());
  
  // Remove deleted tasks from map
  tasksToRemove.forEach(taskId => {
    featureTasks.delete(taskId);
  });
  
  // Add new tasks to map
  newTasks.forEach(task => {
    featureTasks.set(task.id, task);
  });
  
  console.log(`   📊 Queue: ${initialCount} → ${newTaskQueue.size()} tasks (${tasksToRemove.length} removed, ${newTasks.length} added)`);
  
  return {
    ...state,
    taskQueue: newTaskQueue,
    featureTasks
  };
}
