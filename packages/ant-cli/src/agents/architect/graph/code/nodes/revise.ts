import { LLMClient } from "../../../../../core/ports";
import { ArchitectGraphState } from "../state";
import { CodeTask } from "../../../types/task";
import { saveCheckpoint } from "./checkpoint";
import Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from "url";

// ESM: derive __dirname from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'revise');
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
    // Load prompt templates (WHAT/HOW separated per FPOP principle)
    const templateDir = path.join(__dirname, '../../../../../core/prompt/templates/code/phases/revise');
    const baseContent = fs.readFileSync(path.join(templateDir, 'base.md'), 'utf-8');
    const rulesContent = fs.readFileSync(path.join(templateDir, 'rules.md'), 'utf-8');
    
    // Register rules as partial so {{> code/phases/revise/rules }} resolves
    Handlebars.registerPartial('code/phases/revise/rules', rulesContent);
    const template = Handlebars.compile(baseContent);
    
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
    
    const promptData = {
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
    };
    
    // Generate prompt and call LLM
    const prompt = template(promptData);
    
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
      const updatedState = applyTaskModifications(state, decision);
      
      // Update directive with the new one
      if (overrideDirective) {
        updatedState.directive = overrideDirective;
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
      
      if (state.deps?.workflowUpdate && state._httpJobId) {
        state.deps.workflowUpdate.exitNode(state._httpJobId, 'revise');
      }
      
      return updatedState;
    }
    
    // Action is 'continue' - no changes needed
    // But still update directive if new one provided
    const result = { ...state };
    if (overrideDirective) {
      result.directive = overrideDirective;
    }
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'revise');
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ [Revise] Error during revision:', error);
    console.log('   Falling back to CONTINUE (safe default)\n');
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'revise');
    }
    
    return state;
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
      };
      newTasks.push(newTask);
      console.log(`   ➕ Added task: "${newTask.name}" (P${newTask.priority})`);
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
