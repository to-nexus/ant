import { LLMClient } from "../../../../../core/ports";
import { extractLLMInfo } from "../../../../../core/ports/workflow";
import { DesignGraphState } from "../state";
import { DesignTask, TaskQueue } from "../../../types/task";
import { getEstimatingLabel } from "../../../../common/graph/timing/estimatingLabels";
import { LLM_THINKING_BUDGET } from "../../../../common/graph/llmConfig";
import { saveReviseCheckpoint } from "../session/checkpoint";

/**
 * Revise Node for Design Job
 * 
 * Called when: isResume && hasTaskQueue && overrideDirective (new chat input on existing tasks)
 * 
 * Responsibilities:
 * 1. LLM decides: continue (no changes) or modify (add/remove design tasks)
 * 2. If modify: immediately apply task changes to taskQueue
 * 3. Save checkpoint
 * 4. Always routes to → plan
 * 
 * Design-specific: Tasks produce documents (type: 'doc'), each with a targetFile.
 */
export async function revise(state: DesignGraphState): Promise<DesignGraphState> {
  const phaseStart = Date.now();

  const llm = state.deps?.llm as LLMClient;
  
  // ✅ Increment recursion count (track node execution for UI gauge)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // ✅ Workflow tracking: enter node
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
      'revise',
      0,
      taskInfo,
      llm ? extractLLMInfo(llm) : undefined,
      state.recursionCount,
      state.recursionLimit
    );
  }
  
  const overrideDirective = state.overrideDirective;
  
  // If no new directive (just resume button), continue without changes.
  // Skip activity banner — the fast path returns immediately and the next node
  // (parallelOrchestrator) will broadcast actual tasks right away.
  if (!overrideDirective) {
    console.log('📋 [Design Revise] No new directive → CONTINUE (no task changes needed)\n');
    
    state._phaseTimings = { ...(state._phaseTimings || {}), revise: Date.now() - phaseStart };
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'revise', 0);
    }
    
    return state;
  }
  
  // New directive exists — show activity banner before LLM call
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('revise', state._uiLocale), 'revise');
  }
  
  // New directive exists - ask LLM for decision
  const originalDirective = state.directive || '';
  
  console.log(`\n🔍 [Design Revise] Analyzing impact of new directive`);
  console.log(`   Original: "${originalDirective.substring(0, 60)}..."`);
  console.log(`   New:      "${overrideDirective.substring(0, 60)}..."`);
  console.log('   Analyzing...\n');
  
  try {
    const promptBuilder = state.deps?.promptBuilder;
    if (!promptBuilder) {
      throw new Error('[Design Revise] PromptBuilder not available');
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
    const prompt = await promptBuilder.render('jobs/design/nodes/revise/variants/default/base', {
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
      newDirective: overrideDirective,
      directives: []  // Design job uses directive/overrideDirective directly
    });
    
    console.log('🤖 [Design Revise] Asking LLM for decision...');
    
    let response: string;
    if (llm.invokeWithUsage) {
      const result = await llm.invokeWithUsage([
        { role: 'user', content: prompt }
      ], { enableThinking: true, thinkingBudget: LLM_THINKING_BUDGET.REVISE });
      response = result.content;
      // ✅ Track token usage for revise node
      if (result.usage) {
        const { accumulateTokenUsage, logTokenUsageToFile } = await import('../../../../common/graph/llmHelpers');
        accumulateTokenUsage(state, result.usage, { taskLevel: false, jobLevel: true });
        if (state.deps?.kanbanUpdate?.updateTokenUsage && state.tokenUsage) {
          state.deps.kanbanUpdate.updateTokenUsage(state.tokenUsage);
        }
        
        logTokenUsageToFile(
          state.context?.featurePath,
          state.jobId || state._httpJobId,
          result.usage,
          {
            taskId: 'revise',
            taskName: 'revise',
            node: 'revise',
            callIndex: 0,
          }
        );
      }
    } else {
      response = await llm.invoke([
        { role: 'user', content: prompt }
      ]);
    }
    
    // Parse JSON response
    let decision: {
      action: 'continue' | 'modify';
      reason: string;
      tasksToRemove: string[];
      tasksToAdd: Array<{
        name: string;
        description: string;
        type: string;
        priority: number;
        targetFile?: string;
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
      
      console.log(`\n✅ [Design Revise] Decision: ${decision.action.toUpperCase()}`);
      console.log(`   Reason: ${decision.reason}`);
      
    } catch (parseError) {
      console.error('❌ [Design Revise] Failed to parse LLM response as JSON');
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
      
      const updatedState = applyDesignTaskModifications(state, decision);
      
      // Update directive with the new one
      updatedState.directive = overrideDirective;
      
      // ✅ Clear planText + conversations only if the interrupted task itself was affected
      if (isInterruptedTaskAffected) {
        console.log(`   🔄 Interrupted task "${interruptedTaskId}" was affected → clearing planText + conversations`);
        updatedState.planText = '';
        updatedState.conversations = {};
      } else {
        console.log(`   ✅ Interrupted task not affected → preserving planText + conversations`);
      }
      
      await saveReviseCheckpoint(state, updatedState);
      
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
        console.log(`📋 [Design Revise] Task queue updated → Kanban board\n`);
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
    console.error('❌ [Design Revise] Error during revision:', error);
    console.log('   Falling back to CONTINUE (safe default)\n');
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'revise', 0);
    }
    
    // ✅ CRITICAL: Still update directive even on error
    const result = { ...state };
    if (overrideDirective) {
      result.directive = overrideDirective;
    }
    result._phaseTimings = { ...(result._phaseTimings || {}), revise: Date.now() - phaseStart };
    return result;
  }
}

/**
 * Apply task modifications (remove + add) to the design task queue
 */
function applyDesignTaskModifications(
  state: DesignGraphState,
  decision: {
    tasksToRemove: string[];
    tasksToAdd: Array<{
      name: string;
      description: string;
      type: string;
      priority: number;
      targetFile?: string;
    }>;
  }
): DesignGraphState {
  const taskQueue = state.taskQueue;
  if (!taskQueue) {
    console.warn('⚠️  [Design Revise] No task queue found, skipping modifications');
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
  const newTasks: DesignTask[] = [];
  
  if (tasksToAdd.length > 0) {
    for (const taskDef of tasksToAdd) {
      const newTask: DesignTask = {
        id: `revised-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        name: taskDef.name,
        description: taskDef.description,
        type: 'doc',  // Design tasks are always 'doc' type
        priority: taskDef.priority,
        targetFile: taskDef.targetFile,
      };
      newTasks.push(newTask);
      console.log(`   ➕ Added task: "${newTask.name}" → ${newTask.targetFile || 'auto'} (P${newTask.priority})`);
    }
  }
  
  // 3. Rebuild task queue
  const newTaskQueue = TaskQueue.from<DesignTask>([...modifiedTasks, ...newTasks]);
  
  console.log(`   📊 Queue: ${initialCount} → ${newTaskQueue.size()} tasks (${tasksToRemove.length} removed, ${newTasks.length} added)`);
  
  return {
    ...state,
    taskQueue: newTaskQueue,
  };
}
