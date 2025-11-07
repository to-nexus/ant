import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Plan Node
 * Generate design plan based on artifacts
 */
export async function plan(state: DesignGraphState) {
  // ✅ Workflow instrumentation: Enter node
  // ✅ CRITICAL: await to ensure workflow SSE is sent before kanban update
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpTaskId, 'plan', taskInfo);
  }
  
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

  // ✅ Get next task from queue (if using task-based design)
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
      
      // ✅ DON'T update Kanban here!
      // checkTaskCompletion will update to next task after animation completes
    } else {
      console.log('⚠️  No task to execute');
      return state;
    }
  }

  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: undefined,              // Design doesn't use design as input
    prdSpec: state.prd,               // PRD
    previousDesign: state.design,     // Previous design (for evolution/refactor)
    currentCode: state.code,          // Codebase (for evolution/refactor)
    originalFiles: undefined,         // Design doesn't use git HEAD
  };

  // Build prompt using PromptEngine
  const result = await engine.buildPlanPrompt(
    "design",
    state.context,
    artifacts
  );

  // Generate plan with streaming
  let planText = '';
  
  console.log(`⏱️  Prompt build time: ${result.metadata.buildTime}ms`);
  console.log(`🎯 Design mode: ${state.designMode || 'auto'}`);
  console.log('\n📝 Generating design plan...\n');
  
  if (llm.stream) {
    // Use streaming if available
    for await (const chunk of llm.stream(result.formatted.messages)) {
      process.stdout.write(chunk);
      planText += chunk;
    }
    console.log('\n');
  } else {
    // Fallback to regular invoke
    planText = await llm.invoke(result.formatted.messages);
  }

  return { ...state, planText, currentTask };
}
