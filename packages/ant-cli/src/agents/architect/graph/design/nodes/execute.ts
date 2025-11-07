import { DesignGraphState } from "../state";
import { LLMClient } from "../../../../../core/ports";
import { PromptEngine } from "../../../../../core/prompt/engine";

/**
 * Execute Node
 * Generate design document based on plan
 */
export async function execute(state: DesignGraphState) {
  // ✅ Workflow instrumentation: Enter node
  if (state.deps?.workflowUpdate && state._httpTaskId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    state.deps.workflowUpdate.enterNode(state._httpTaskId, 'execute', taskInfo);
  }
  
  const llm = state.deps?.llm as LLMClient;
  const engine = state.deps?.promptEngine as PromptEngine;

  // Prepare artifacts (using new unified names)
  const artifacts = {
    directive: state.directive,
    designDoc: undefined,              // Design doesn't use design as input
    prdSpec: state.prd,               // PRD
    previousDesign: state.design,     // Previous design
    currentCode: state.code,          // Codebase (for evolution/refactor)
    originalFiles: undefined,         // Design doesn't use git HEAD
    currentTask: state.currentTask ? {  // ✅ Pass current task info
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description
    } : undefined
  };

  // Build prompt using PromptEngine
  const result = await engine.buildExecutePrompt(
    "design",
    state.context,
    artifacts,
    state.planText
  );

  // Generate design with streaming
  let designMarkdown = '';
  
  console.log(`⏱️  Prompt build time: ${result.metadata.buildTime}ms`);
  console.log('\n📐 Generating design document...\n');
  
  if (llm.stream) {
    // Use streaming if available
    for await (const chunk of llm.stream(result.formatted.messages)) {
      process.stdout.write(chunk);
      designMarkdown += chunk;
    }
    console.log('\n');
  } else {
    // Fallback to regular invoke
    designMarkdown = await llm.invoke(result.formatted.messages);
  }

  // ✅ Mark current task as completed
  let completedTasks = state.completedTasks || [];
  let completedTasksDetails = state.completedTasksDetails || [];
  
  if (state.currentTask) {
    // ✨ Complete task with timing
    const { TaskTimingHelper } = await import('../../code/state');
    const completedTask = TaskTimingHelper.completeTask(state.currentTask);
    
    if (completedTask.timing?.elapsedTime) {
      const formattedTime = TaskTimingHelper.formatElapsedTime(completedTask.timing.elapsedTime);
      console.log(`✅ Task "${completedTask.name}" completed in ${formattedTime}!`);
    } else {
      console.log(`✅ Task "${completedTask.name}" completed!`);
    }
    
    completedTasks.push(completedTask.id);
    completedTasksDetails.push(completedTask);
    
    // ✅ Update live Kanban snapshot
    if (state._httpTaskId && state.taskQueue) {
      const queueTasks = state.taskQueue.getAll();
      
      console.log(`\n🔥 [Design Execute] Updating Kanban - task completed`);
      console.log(`   Completed task: ${completedTask.name}`);
      console.log(`   Total completed: ${completedTasksDetails.length}`);
      console.log(`   Queue remaining: ${queueTasks.length}`);
      
      if (state.deps?.kanbanUpdate) {
        // In-process: use injected port
        console.log(`   Method: Direct port call\n`);
        state.deps.kanbanUpdate.updateTaskQueue(
          state._httpTaskId,
          undefined,  // currentTask is now undefined (just completed)
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
              currentTask: undefined,
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
  }

  return { 
    ...state, 
    designMarkdown,
    currentTask: undefined,  // Clear current task
    completedTasks,
    completedTasksDetails
  };
}
