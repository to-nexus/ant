import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Plan Node
 * Generate design plan based on artifacts
 */
export async function plan(state: DesignGraphState) {
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

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
    
    // ✅ Extract LLM info from GenericLLMClient
    const llmInfo = (llm as any)?.provider && (llm as any)?.modelName ? {
      provider: (llm as any).provider,
      model: (llm as any).modelName
    } : undefined;
    
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'plan', taskInfo, llmInfo);
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
      contextParts.push('- `write_file(path, content)`: Create/modify files');
      contextParts.push('- `delete_file(path)`: Remove files\n');
      
      currentCode = contextParts.join('\n');
      
    } catch (error) {
      console.warn(`⚠️  Smart context loading failed:`, error);
      currentCode = state.code; // Fallback to original
    }
  }
  
  // Prepare artifacts (using new unified names)
  // ✅ Get accumulated design from previous tasks (files[])
  const primaryDesign = state.files?.find(f => 
    f.path.includes('system-design') || f.path.includes('design.md')
  );

  const artifacts = {
    directive: state.directive,
    designDoc: primaryDesign?.content,  // ✅ Pass accumulated design for continuation detection
    prdSpec: state.prd,               // PRD
    previousDesign: state.design,     // Previous design (for evolution/refactor)
    currentCode: currentCode,         // ✅ Codebase (with smart context!)
    originalFiles: undefined,         // Design doesn't use git HEAD
    currentTask: currentTask ? {      // ✅ Pass current task info to plan prompt
      name: currentTask.name,
      type: currentTask.type,
      description: currentTask.description
    } : undefined
  };

  // Build prompt using PromptEngine
  const result = await engine.buildPlanPrompt(
    "design",
    state.context,
    artifacts
  );

  const planText = '';

  // ✅ DEBUG: Verify timing before return
  console.log(`\n🔍 [Design Plan] About to return state:`);
  console.log(`   currentTask: ${currentTask?.name}`);
  console.log(`   Has timing: ${!!currentTask?.timing}`);
  console.log(`   timing.startedAt: ${currentTask?.timing?.startedAt}\n`);

  // ✅ planText를 메모리(state)에 저장하여 execute 노드에서 직접 사용
  return { ...state, planText, currentTask };
}
