import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Plan Node
 * Generate design plan based on artifacts
 */
export async function plan(state: DesignGraphState) {
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    state.deps.workflowUpdate.enterNode(state._httpTaskId, 'plan', taskInfo);
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
      
      // ✅ Update live Kanban snapshot
      if (state._httpTaskId) {
        const queueTasks = state.taskQueue.getAll();
        const completedTasksDetails = state.completedTasksDetails || [];
        
        console.log(`🔥 [Design Plan] Updating Kanban - moved task to In Progress`);
        console.log(`   Current task: ${currentTask.name}`);
        console.log(`   Queue remaining: ${queueTasks.length}`);
        console.log(`   Completed: ${completedTasksDetails.length}`);
        
        if (state.deps?.kanbanUpdate) {
          // In-process: use injected port
          console.log(`   Method: Direct port call\n`);
          state.deps.kanbanUpdate.updateTaskQueue(
            state._httpTaskId,
            currentTask,
            queueTasks,
            completedTasksDetails
          );
        } else {
          // Child process: HTTP API fallback
          console.log(`   Method: HTTP API fallback\n`);
          const serverPort = process.env.ANT_SERVER_PORT || '4100';
          try {
            // ✅ CRITICAL: await fetch to ensure update is sent before continuing
            const response = await fetch(`http://localhost:${serverPort}/api/internal/task-queue`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                taskId: state._httpTaskId,
                currentTask: currentTask,
                queue: queueTasks,
                completedTasks: completedTasksDetails
              })
            });
            
            if (response.ok) {
              console.log(`   ✅ HTTP update successful\n`);
            } else {
              console.log(`   ⚠️  HTTP update failed: ${response.status} ${response.statusText}\n`);
            }
          } catch (err: any) {
            console.log(`   ⚠️  HTTP update error: ${err.message}\n`);
          }
        }
      }
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
