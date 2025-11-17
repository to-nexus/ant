import { StateGraph } from "@langchain/langgraph";
import { ArchitectGraphState, TASK_PRIORITIES, Task, TaskTimingHelper } from "./state";
import { resolve, decompose, plan, execute, writeFiles, validate, installDeps, runtimeValidate, enforce, learn } from "./nodes/index";
import { saveCheckpoint } from "./nodes/checkpoint";

/**
 * Node that handles task completion logic and state mutations.
 * This MUST be a node (not a router) because it mutates state.
 */
async function checkTaskStatus(state: ArchitectGraphState): Promise<Partial<ArchitectGraphState>> {
  // ✅ Increment recursion count (track every node execution)
  state.recursionCount = (state.recursionCount || 0) + 1;
  
  // ✅ Workflow instrumentation: Enter node
  // ✅ CRITICAL: await to ensure workflow SSE is sent before continuing
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = state.currentTask ? {
      id: state.currentTask.id,
      name: state.currentTask.name,
      type: state.currentTask.type,
      description: state.currentTask.description,
      priority: state.currentTask.priority
    } : undefined;
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'checkTaskStatus', taskInfo);
  }
  
  const hasViolations = (state.violations && state.violations.length > 0);
  
  if (!hasViolations && state.currentTask) {
    // ✅ Task succeeded - mark as completed and record timing
    const completedTask = TaskTimingHelper.completeTask(state.currentTask);
    
    if (completedTask.timing?.elapsedTime) {
      const formattedTime = TaskTimingHelper.formatElapsedTime(completedTask.timing.elapsedTime);
      console.log(`✅ Task "${completedTask.name}" completed in ${formattedTime}!`);
    } else {
      console.log(`✅ Task "${completedTask.name}" completed!`);
    }
    
    // Update completedTasks (IDs only - for backward compatibility)
    const completedTasks = state.completedTasks || [];
    completedTasks.push(completedTask.id);
    
    // ✅ NEW: Store full task details in completedTasksDetails
    const completedTasksDetails = state.completedTasksDetails || [];
    completedTasksDetails.push(completedTask);
    
    console.log(`[checkTaskStatus] 💾 Saving completed task to completedTasksDetails:`, {
      taskId: completedTask.id,
      taskName: completedTask.name,
      hasTiming: !!completedTask.timing,
      hasDescription: !!completedTask.description,
      totalCompletedTasksDetails: completedTasksDetails.length,
      completedTasksDetailsIds: completedTasksDetails.map(t => t.id)
    });
    
    // ✅ CRITICAL: Save checkpoint after completing a task
    // This ensures completedTasksDetails is persisted to session
    const { saveCheckpoint } = await import('./nodes/checkpoint');
    const stateWithCompletedTask = {
      ...state,
      completedTasks,
      completedTasksDetails,
      currentTask: undefined
    };
    
    await saveCheckpoint(stateWithCompletedTask);
    console.log(`[checkTaskStatus] ✅ Checkpoint saved with completedTasksDetails (${completedTasksDetails.length} tasks)`);
    
    // If feature task, mark in featureTasks map
    if (completedTask.type === 'feature' && state.featureTasks) {
      const feature = state.featureTasks.get(completedTask.id);
      if (feature) {
        feature.completed = true;
      }
    }
    
    // If error task completed, remove remaining error tasks (likely auto-resolved)
    if (state.currentTask.type === 'error' && state.taskQueue) {
      const errorCount = state.taskQueue.getAll().filter((t: Task) => t.type === 'error').length;
      if (errorCount > 0) {
        console.log(`🧹 Removing ${errorCount} remaining error task(s) from queue (likely auto-resolved)`);
        state.taskQueue.removeType('error');
        
        // Check if Final Verification already exists in queue
        const hasFinalTask = state.taskQueue.getAll().some((t: Task) => t.priority === TASK_PRIORITIES.FINAL_VERIFICATION);
        
        if (!hasFinalTask) {
          const finalTask: Task = {
            id: `final-verification-recheck-${Date.now()}`,
            name: 'Final Verification (Recheck)',
            type: 'feature' as const,
            priority: TASK_PRIORITIES.FINAL_VERIFICATION,
            description: 'Re-verify all errors are resolved after error fixes',
            validationRequired: true,
            validationType: 'runtime' as const,
          };
          state.taskQueue.push(finalTask);
          console.log(`📋 Re-added Final Verification to confirm all errors resolved\n`);
        } else {
          console.log(`📋 Final Verification already in queue - will execute after error tasks\n`);
        }
      }
    }
    
    // ✅ CRITICAL: Update state with completedTasksDetails
    const updatedState = {
      ...state,
      completedTasks,
      completedTasksDetails, // ✅ NEW: Add full task details to state
      currentTask: undefined,
      retries: 0,
      violations: [],
      enforcementReason: undefined,
    };
    
    // ✅ CRITICAL: Save checkpoint with updated completedTasksDetails
    await saveCheckpoint(updatedState);
    
    // ✅ CRITICAL: Update Kanban to next task AFTER checkTaskStatus SSE sent
    // This ensures frontend sees checkTaskStatus animation before Kanban switches
    if (state.deps?.kanbanUpdate && state._httpJobId && updatedState.taskQueue) {
      const allTasks = updatedState.taskQueue.getAll();
      const nextTask = updatedState.taskQueue.peek(); // ✅ Use peek() for correct next task
      
      // ✅ CRITICAL: Remove nextTask from queue display (it's now in progress)
      const remainingQueue = nextTask ? allTasks.filter((t: Task) => t.id !== nextTask.id) : allTasks;
      
      console.log(`\n🔥 [checkTaskStatus] Updating Kanban → next task`);
      console.log(`   Completed: ${completedTask.name}`);
      console.log(`   Next: ${nextTask?.name || 'none (learn)'}`);
      console.log(`   Remaining in queue: ${remainingQueue.length}`);
      console.log(`   Total completed: ${completedTasksDetails.length}\n`);
      
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        nextTask || null,  // ✅ Show next task as in-progress
        remainingQueue,    // ✅ Exclude nextTask from queue
        completedTasksDetails,
        state.recursionCount,
        state.recursionLimit
      );
    }
    
    return {
      completedTasks,
      completedTasksDetails,
      currentTask: undefined,
      retries: 0,
      violations: [],
      enforcementReason: undefined,
      recursionCount: state.recursionCount,  // ✅ Propagate recursion count
      recursionLimit: state.recursionLimit,  // ✅ Propagate recursion limit
    };
  }
  
  // Task failed or has violations - propagate recursion tracking
  return {
    recursionCount: state.recursionCount,  // ✅ Propagate recursion count
    recursionLimit: state.recursionLimit,  // ✅ Propagate recursion limit
  };
}

export function buildCodeGraph() {
  const graph = new StateGraph<ArchitectGraphState>({
    channels: {
      // Context & Input
      context: null as any,
      spec: null as any,
      
      // Dependencies
      deps: null as any,
      gitPort: null as any,
      
      // Mode
      codeMode: null as any,
      
      // Artifacts (from TaskArtifacts)
      prd: null as any,
      directive: null as any,
      design: null as any,
      code: null as any,
      codeHead: null as any,
      profile: null as any,
      
      // Execution
      planText: null as any,
      codePrompt: null as any,
      rawResponse: null as any,
      responseSection: null as any,
      files: null as any,
      filesToDelete: null as any,
      modifications: null as any,
      
      // Integrations & Validation
      requiredIntegrations: null as any,
      violations: null as any,
      retries: null as any,
      maxRetries: null as any,
      runtimeValidationResult: null as any,
      enforcementReason: null as any,  // ✅ For enforce → plan communication
      
      // Progress tracking
      lastViolations: null as any,
      previousFileCount: null as any,
      
      // Attempt history
      previousAttempts: null as any,
      
      // Enforcement feedback history
      enforcementHistory: null as any,
      
      // Task Queue System
      taskQueue: null as any,
      currentTask: null as any,
      featureTasks: null as any,
      completedTasks: null as any,
      completedTasksDetails: null as any,  // ✅ Full task objects for completed tasks
      resolvedCategories: null as any,
      
      // ✅ Job tracking (for timing and continuity)
      jobId: null as any,
      jobTiming: null as any,
      
      // Error Handling & Final Verification
      failedTasks: null as any,
      unresolvedErrors: null as any,
      
      // Evaluation & Learning
      evaluationReport: null as any,
      learnings: null as any,
      
      // Results
      branch: null as any,
      filesWritten: null as any,
      reportFile: null as any,
      
      // Real-time Kanban tracking
      _httpJobId: null as any,  // ✅ HTTP task ID for live updates
      
      // ✅ Error repetition tracking
      _errorIsRepeating: null as any,  // Flag to indicate if errors are repeating
      
      // Recursion tracking
      recursionCount: null as any,  // ✅ Current iteration count
      recursionLimit: null as any,  // ✅ Maximum allowed iterations
    } as any,
  } as any);
  
  graph.addNode("resolve", resolve as any);
  graph.addNode("decompose", decompose as any);  // NEW: Meta-level task decomposition
  graph.addNode("plan", plan as any);
  graph.addNode("execute", execute as any);
  graph.addNode("writeFiles", writeFiles as any);  // ✅ Write files immediately
  graph.addNode("validate", validate as any);
  graph.addNode("installDeps", installDeps as any);  // ✅ Install after validation
  graph.addNode("runtimeValidate", runtimeValidate as any);
  graph.addNode("checkTaskStatus", checkTaskStatus as any);  // ✅ NEW: Handle task completion logic
  graph.addNode("enforce", enforce as any);
  graph.addNode("learn", learn as any);

  graph.addEdge("__start__" as any, "resolve" as any);
  graph.addEdge("resolve" as any, "decompose" as any);  // resolve → decompose
  graph.addEdge("decompose" as any, "plan" as any);     // decompose → plan (first task)
  
  // ✅ Plan always goes to execute
  graph.addEdge("plan" as any, "execute" as any);
  
  // ✅ CRITICAL: Write files immediately after execute
  graph.addEdge("execute" as any, "writeFiles" as any);
  
  // ✅ Validate after files are written
  graph.addEdge("writeFiles" as any, "validate" as any);

  // Static validation (ellipsis, excessive deletion)
  graph.addConditionalEdges(
    "validate" as any,
    ((s: ArchitectGraphState) => {
      // ✅ Only check violations array (validate node handles no_files violation internally)
      const hasViolations = s.violations && s.violations.length > 0;
      if (hasViolations) {
        return "enforce";
      }
      return "installDeps";  // ✅ Static validation passed → Install dependencies
    }) as any,
    { enforce: "enforce", installDeps: "installDeps" } as any
  );

  // After installing dependencies, run runtime validation
  graph.addEdge("installDeps" as any, "runtimeValidate" as any);

  // After runtime validation, check task status (moved from router to node for state mutation)
  graph.addEdge("runtimeValidate" as any, "checkTaskStatus" as any);

  // Route based on task completion status
  graph.addConditionalEdges(
    "checkTaskStatus" as any,
    ((s: ArchitectGraphState) => {
      const hasViolations = (s.violations && s.violations.length > 0);
      
      if (!hasViolations) {
        // ✅ Task succeeded - ALWAYS go to learn for incremental learning
        return "learn";
      }
      
      // Has violations - check if we should retry
      if (s.retries < s.maxRetries) {
        return "enforce";
      }
      
      // Exceeded retries
      console.log(`⚠️  Task "${s.currentTask?.name}" exhausted retries (${s.retries}/${s.maxRetries})`);
      console.log(`   Plan node will create error task and move to next task\n`);
      return "enforce";  // ← Let plan handle retry limit logic
    }) as any,
    { enforce: "enforce", learn: "learn" } as any
  );

  // ✅ KEY CHANGE: Enforce → Plan (not Execute)
  // This allows the agent to re-analyze the problem and create a better strategy
  graph.addEdge("enforce" as any, "plan" as any);
  
  // ✅ NEW: Learn node routing - continue to next task or end
  graph.addConditionalEdges(
    "learn" as any,
    ((s: ArchitectGraphState) => {
      // Check if more tasks exist in queue
      if (s.taskQueue && !s.taskQueue.isEmpty()) {
        console.log(`\n📋 [Learn] More tasks in queue (${s.taskQueue.size()} remaining) → continuing to plan\n`);
        return "plan";  // ← Next task
      } else {
        console.log(`\n✅ [Learn] All tasks completed! Workflow finished.\n`);
        return "__end__";  // ← All done
      }
    }) as any,
    { plan: "plan", __end__: "__end__" } as any
  );
  
  // Note: Using manual checkpoint saves instead of LangGraph's built-in checkpointer
  // because it requires thread_id management which complicates the API
  
  // ✅ DON'T set recursionLimit here - it's set in runner.ts invoke() call
  // (invoke() recursionLimit takes precedence over compile())
  return (graph as any).compile();
}
