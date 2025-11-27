import { StateGraph } from "@langchain/langgraph";
import { ArchitectGraphState, TASK_PRIORITIES, Task, TaskTimingHelper } from "./state";
import { resolve } from "./nodes/resolve";
import { decompose } from "./nodes/decompose";
import { plan } from "./nodes/plan";
import { codeGen } from "./nodes/codeGen";
import { tool } from "./nodes/tool";
// import { validate } from "./nodes/validate";  // ✅ REMOVED: Static validation no longer needed (prompts handle it)
import { installDeps } from "./nodes/installDeps";
import { runtimeValidate } from "./nodes/runtimeValidate";
import { enforce } from "./nodes/enforce";
import { learn } from "./nodes/learn";
import { routeAfterCodeGen } from "./routers/codeGenRouter";
import { saveCheckpoint } from "./nodes/checkpoint";
import { replanDecision } from "./nodes/replanDecision";
import { modifyTasks } from "./nodes/modifyTasks";
import { clearStateForReplan } from "./nodes/clearStateForReplan";
import { routeAfterReplanDecision } from "./routers/replanRouter";

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
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 
      'checkTaskStatus', 
      taskInfo, 
      undefined, // llmInfo
      state.recursionCount,
      state.recursionLimit
    );
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
    
    // ✅ CRITICAL: Clear conversation history for next task
    // Each task should start fresh without previous task's conversation
    state.conversationHistory = [];
    console.log(`🧹 [checkTaskStatus] Cleared conversation history for next task`);
    
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
    const { saveCheckpoint } = await import('./nodes/checkpoint');
    await saveCheckpoint(updatedState);
    console.log(`[checkTaskStatus] ✅ Checkpoint saved with completedTasksDetails (${completedTasksDetails.length} tasks)`);
    
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
    
    // ✅ Workflow instrumentation: Exit node (task completed path)
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus');
    }
    
    return {
      completedTasks,
      completedTasksDetails,
      currentTask: undefined,
      retries: 0,
      violations: [],
      enforcementReason: undefined,
      conversationHistory: [],  // ✅ Clear for next task
      recursionCount: state.recursionCount,  // ✅ Propagate recursion count
      recursionLimit: state.recursionLimit,  // ✅ Propagate recursion limit
    };
  }
  
  // ✅ Workflow instrumentation: Exit node (task failed/has violations path)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'checkTaskStatus');
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
      lessons: null as any,
      
      // Results
      branch: null as any,
      filesWritten: null as any,
      reportFile: null as any,
      
      // Real-time Kanban tracking
      _httpJobId: null as any,  // ✅ HTTP task ID for live updates
      
      // ✅ Chat integration
      overrideDirective: null as any,  // ✅ Chat input as directive (highest priority)
      chatSource: null as any,  // ✅ Flag for Chat SSE
      
      // ✅ Error repetition tracking
      _errorIsRepeating: null as any,  // Flag to indicate if errors are repeating
      
      // Recursion tracking
      recursionCount: null as any,  // ✅ Current iteration count
      recursionLimit: null as any,  // ✅ Maximum allowed iterations
      
      // ✅ NEW: Tool Calling support
      llmResponse: null as any,     // LLM response (thinking, text, tool calls)
      toolResults: null as any,     // Tool execution results
      conversationHistory: null as any,  // Multi-turn conversation
    } as any,
  } as any);
  
  // ✅ SIMPLIFIED ARCHITECTURE: CodeGen <-> Tool loop, then branch by priority
  graph.addNode("resolve", resolve as any);
  graph.addNode("decompose", decompose as any);
  graph.addNode("replanDecision", replanDecision as any);  // ✅ NEW: Replan decision (continue/modify/restart)
  graph.addNode("modifyTasks", modifyTasks as any);        // ✅ NEW: Modify specific tasks
  graph.addNode("clearStateForReplan", clearStateForReplan as any);  // ✅ NEW: Clear state for restart
  graph.addNode("plan", plan as any);
  graph.addNode("codeGen", codeGen as any);      // ✅ Code generation (LLM reasoning)
  graph.addNode("tool", tool as any);            // ✅ Single tool execution (saves immediately!)
  // graph.addNode("validate", validate as any);  // ✅ REMOVED: Prompts handle static validation
  graph.addNode("installDeps", installDeps as any);
  graph.addNode("runtimeValidate", runtimeValidate as any);
  graph.addNode("checkTaskStatus", checkTaskStatus as any);
  graph.addNode("enforce", enforce as any);
  graph.addNode("learn", learn as any);

  graph.addEdge("__start__" as any, "resolve" as any);
  graph.addEdge("resolve" as any, "decompose" as any);
  
  // ✅ Decompose → Replan Decision (check for multiple directives)
  graph.addConditionalEdges(
    "decompose" as any,
    ((state: ArchitectGraphState) => {
      // Check if this is a resume with multiple directives
      const hasMultipleDirectives = (state.directives?.length || 0) > 1;
      const hasTaskQueue = state.taskQueue && state.taskQueue.size() > 0;
      
      if (hasMultipleDirectives && hasTaskQueue) {
        return 'replanDecision';
      }
      return 'plan';
    }) as any,
    {
      replanDecision: "replanDecision",
      plan: "plan"
    } as any
  );
  
  // ✅ Replan Decision → Router (continue/modify/restart)
  graph.addConditionalEdges(
    "replanDecision" as any,
    routeAfterReplanDecision as any,
    {
      plan: "plan",
      modifyTasks: "modifyTasks",
      clearStateForReplan: "clearStateForReplan"
    } as any
  );
  
  // ✅ Modify Tasks → Plan (continue with modified queue)
  graph.addEdge("modifyTasks" as any, "plan" as any);
  
  // ✅ Clear State → Decompose (restart with new plan)
  graph.addEdge("clearStateForReplan" as any, "decompose" as any);
  
  // ✅ Plan → CodeGen (시작)
  graph.addEdge("plan" as any, "codeGen" as any);
  
  // ✅ CodeGen → Router (tool call 체크 & priority 기반 분기)
  graph.addConditionalEdges(
    "codeGen" as any,
    routeAfterCodeGen as any,
    {
      tool: "tool",                     // Tool call 있으면 → tool 노드
      checkTaskStatus: "checkTaskStatus",  // Done (non-final) → checkTaskStatus
      installDeps: "installDeps",       // Done (final task) → installDeps
      codeGen: "codeGen",               // 재추론 (드물음)
    } as any
  );
  
  // ✅ Tool → CodeGen (도구 결과 가지고 다시 추론)
  graph.addEdge("tool" as any, "codeGen" as any);

  // ✅ REMOVED: validate 노드 관련 로직 제거
  // - Static validation (ellipsis, excessive deletion)은 프롬프트로 충분히 제어
  // - Runtime validation (build)만 final task에서 실행

  // ✅ Final task: installDeps → runtimeValidate
  graph.addEdge("installDeps" as any, "runtimeValidate" as any);

  // ✅ Final task: runtimeValidate → checkTaskStatus
  graph.addEdge("runtimeValidate" as any, "checkTaskStatus" as any);

  // ✅ checkTaskStatus: 태스크 완료 상태 확인 및 라우팅
  // - Non-final tasks: codeGen → checkTaskStatus (직접)
  // - Final task: codeGen → installDeps → runtimeValidate → checkTaskStatus
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
