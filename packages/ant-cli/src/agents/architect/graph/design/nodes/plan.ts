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

  // ✅ SMART CONTEXT PRE-LOADING (like code job!)
  let currentCode = state.code;
  
  // Only reload context if we have existing code (evolution/refactor mode)
  const gitPort = state.deps?.git;
  const hasExistingCode = Boolean(state.code && state.code.trim().length > 0);
  const shouldReload = hasExistingCode && gitPort && currentTask;
  
  if (shouldReload && currentTask) {
    console.log(`📂 Smart context loading for design task: ${currentTask.name}`);
    
    try {
      const { analyzeContextNeeds } = await import('../../../context/analyzer');
      const { loadContext } = await import('../../../context/loader');
      
      // Analyze what context we need (based on TASK, not directive!)
      const strategy = analyzeContextNeeds(
        currentTask,                 // PRIMARY: Task itself
        undefined,                   // SECONDARY: No enforcement in design
        state.prd,                   // TERTIARY: PRD document
        state.files?.map(f => f.path) // QUATERNARY: Existing files
      );
      
      console.log(`   🧠 Context strategy:`, {
        explore: strategy.needsExplore,
        grep: strategy.needsGrep,
        read: strategy.needsRead,
        keywords: strategy.keywords,
      });
      
      // Load context (with UI)
      const context = await loadContext(strategy, gitPort);
      
      console.log(`   ✅ ${context.summary}`);
      
      // Build context for LLM
      const contextParts: string[] = ['=== CODEBASE CONTEXT ===\n'];
      
      if (context.fileTree) { contextParts.push(context.fileTree); contextParts.push(''); }
      if (context.grepResults) { contextParts.push(context.grepResults); contextParts.push(''); }
      if (context.fileContents) { contextParts.push(context.fileContents); contextParts.push(''); }
      
      contextParts.push('💡 **Available Tools** (use if you need more info):');
      contextParts.push('- `read_file(path)`: Read any file');
      contextParts.push('- `search_code(pattern)`: Search for code');
      contextParts.push('- `list_files(directory)`: List specific directory');
      contextParts.push('- `delete_file(path)`: Remove files\n');
      
      currentCode = contextParts.join('\n');
      
    } catch (error) {
      console.warn(`⚠️  Smart context loading failed:`, error);
      currentCode = state.code; // Fallback to original
    }
  }
  
  // ✅ Plan node now ONLY manages task queue
  // No LLM call, no planText generation
  // docGen will handle all LLM communication and document generation
  
  console.log(`\n✅ [Plan] Task prepared for execution`);
  console.log(`   Task: ${currentTask?.name}`);
  console.log(`   Next node: docGen will generate document\n`);
  
  return { ...state, currentTask, code: currentCode };
}
