import { StateGraph } from "@langchain/langgraph";
import { DesignGraphState } from "./state";
import { resolve } from "./nodes/resolve";
import { triage, routeAfterTriage } from "../../../common/nodes/triage";  // ✅ Triage System
import { decompose } from "./nodes/decompose/index";
import { plan } from "./nodes/plan";
import { docGen } from "./nodes/docGen/index";  // ✅ XML streaming + immediate file writes
import { tool } from "./nodes/tool";  // ✅ Tool execution node (for UI Design multimodal)
import { learn } from "./nodes/learn";
import { detectEnvironment } from "./nodes/detectEnvironment";
import { revise } from "./nodes/revise";

/**
 * Check task status and handle completion
 * Routes to plan (next task) or learn (all done)
 * 
 * This MUST be a node (not a router) because it mutates state.
 * Consistent with code job's checkTaskStatus node.
 */
async function checkTaskStatus(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
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
  
  // ✅ Current task completed successfully
  if (state.currentTask) {
    // ✅ Get helpers
    const { TaskTimingHelper } = await import('../code/state');
    const { getTaskTokenUsage, accumulateTokenUsage } = await import('../common/llmHelpers');
    
    // ✅ Get task-level token usage
    const taskTokenUsage = getTaskTokenUsage(state as any);
    
    // ✅ Complete task with timing and token usage
    const completedTask = TaskTimingHelper.completeTask(state.currentTask, taskTokenUsage);
    
    // ✅ Accumulate task tokens into job-level tokenUsage
    if (taskTokenUsage) {
      accumulateTokenUsage(state as any, taskTokenUsage, { taskLevel: false, jobLevel: true });
    }
    
    // ✅ Log completion
    if (completedTask.timing?.elapsedTime) {
      const formattedTime = TaskTimingHelper.formatElapsedTime(completedTask.timing.elapsedTime);
      console.log(`✅ Task "${completedTask.name}" completed in ${formattedTime}!`);
      if (completedTask.tokenUsage) {
        console.log(`   Tokens: ${completedTask.tokenUsage.totalTokens} total (${completedTask.tokenUsage.inputTokens} in, ${completedTask.tokenUsage.outputTokens} out)`);
      }
    } else {
      console.log(`✅ Task "${completedTask.name}" completed!`);
    }
    
    // ✅ CRITICAL: Create NEW arrays (immutable update pattern for LangGraph)
    const completedTasks = [...(state.completedTasks || []), completedTask.id];
    const completedTasksDetails = [...(state.completedTasksDetails || []), completedTask];
    
    console.log(`[checkTaskStatus] 💾 Task completion details saved:`, {
      taskId: completedTask.id,
      taskName: completedTask.name,
      totalCompleted: completedTasksDetails.length
    });
    
    // ✅ CRITICAL: Save checkpoint after completing a task
    if (state.deps?.session && state.context.featureFolder) {
      try {
        await state.deps.session.updateArtifacts(
          state.context.project,
          state.context.featureFolder,
          'design',
          {
            state: {
              taskQueue: state.taskQueue?.getAll() || [],
              completedTasks,
              completedTasksDetails,
              currentTask: undefined,
              planText: state.planText,
              conversationHistory: [],  // ✅ Reset between tasks (task completed)
              files: state.files || [],  // ✅ Save generated files
              filesToDelete: state.filesToDelete || [],
              jobId: (state as any).jobId,
              jobTiming: (state as any).jobTiming,
              tokenUsage: (state as any).tokenUsage,  // ✅ Save job-level token usage
              overrideDirective: state.overrideDirective,  // ✅ Save chat-initiated directive
              chatSource: state.chatSource,  // ✅ Save chat source flag
              detectionReport: state.detectionReport,  // ✅ Save for resume routing
            }
          }
        );
        console.log(`[checkTaskStatus] ✅ Checkpoint saved (${completedTasksDetails.length} tasks completed)\n`);
      } catch (error) {
        console.warn(`[checkTaskStatus] ⚠️  Failed to save checkpoint:`, error);
      }
    }
    
    // ✅ CRITICAL: Update Kanban to next task AFTER checkTaskStatus SSE sent
    // This ensures frontend sees checkTaskStatus animation before Kanban switches
    if (state._httpJobId && state.taskQueue && state.deps?.kanbanUpdate) {
      const allTasks = state.taskQueue.getAll();
      const nextTask = state.taskQueue.peek(); // ✅ Use peek() for correct next task
      
      // ✅ CRITICAL: Remove nextTask from queue display (it's now in progress)
      const remainingQueue = nextTask ? allTasks.filter(t => t.id !== nextTask.id) : allTasks;
      
      console.log(`\n🔥 [checkTaskStatus] Updating Kanban → next task`);
      console.log(`   Completed: ${completedTask.name}`);
      console.log(`   Next: ${nextTask?.name || 'none (learn)'}`);
      console.log(`   Remaining in queue: ${remainingQueue.length}`);
      console.log(`   Total completed: ${completedTasksDetails.length}\n`);
      
      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        nextTask || null,
        remainingQueue,  // ✅ Exclude nextTask from queue
        completedTasksDetails
      );
    }
    
    // Return updated state
    return {
      completedTasks,
      completedTasksDetails,
      currentTask: undefined,
      planText: '',  // ✅ Clear for next task - prevents stale planText leaking
      conversationHistory: [],  // ✅ CRITICAL: Reset conversation history between tasks
      files: [],  // ✅ CRITICAL: Reset files for next task (each task generates fresh)
      tokenUsage: (state as any).tokenUsage,  // ✅ CRITICAL: Return accumulated job-level token usage
    };
  }
  
  // No current task (shouldn't happen, but handle gracefully)
  return { currentTask: undefined };
}

export function buildDesignGraph() {
  const graph = new StateGraph<DesignGraphState>({
    channels: {
      // Context & Input
      context: null as any,
      workspaceConfig: null as any,
      
      // Dependencies (MUST be in channels to be passed between nodes!)
      deps: null as any,
      
      // ✅ CRITICAL: Detection Report (unified environment detection result)
      // Contains: workType (ui-design/system-design), jobMode, environment, domain
      detectionReport: null as any,
      
      // ✅ Error handling for invalid requests (e.g., modify without documents)
      designError: null as any,
      
      // Artifacts
      prd: null as any,
      directive: null as any,
      design: null as any,
      
      // Task Queue (like code graph)
      taskQueue: null as any,
      currentTask: null as any,
      completedTasks: null as any,
      completedTasksDetails: null as any,
      
      // Job tracking (for timing and continuity)
      jobId: null as any,
      jobTiming: null as any,
      
      // Token usage tracking (task-level and job-level)
      _currentTaskTokenUsage: null as any,
      tokenUsage: null as any,
      
      // Execution
      planText: null as any,
      files: null as any,
      filesToDelete: null as any,
      lessons: null as any,
      
      // Tool Calling Support
      llmResponse: null as any,
      conversationHistory: null as any,
      
      // For tracking in UI
      _httpJobId: null as any,
      
      // Chat integration
      overrideDirective: null as any,
      chatSource: null as any,
      
      // Triage System
      skipTriage: null as any,
      triageResult: null as any,
      workspaceState: null as any,
      currentAgent: null as any,
      currentJob: null as any,
      
      // UI document generation context
      uiReferences: null as any,
      uiAssetsList: null as any,
      
      // ✅ Resume flag (set by runner before graph invoke)
      isResume: null as any,
    } as any,
  } as any);

  graph.addNode("resolve" as const, resolve as any);
  graph.addNode("triage" as const, triage as any);  // ✅ Triage: analyze intent and prerequisites
  graph.addNode("detectEnvironment" as const, detectEnvironment as any);
  graph.addNode("decompose" as const, decompose as any);
  graph.addNode("revise" as const, revise as any);  // ✅ Task queue revision (on resume with new directive)
  graph.addNode("plan" as const, plan as any);
  graph.addNode("docGen" as const, docGen as any);  // ✅ XML streaming + immediate file writes (like code job)
  graph.addNode("tool" as const, tool as any);  // ✅ Tool execution (for UI Design multimodal image loading)
  graph.addNode("checkTaskStatus" as const, checkTaskStatus as any);
  graph.addNode("learn" as const, learn as any);

  // ✅ Unified flow: resolve → [4-way routing] → ... → [plan → docGen → check] → learn
  // Design job now writes files immediately like code job (no separate writeFiles node)
  // docGen: XML streaming + immediate writes to disk (with LAST_SECTION handling)
  (graph as any).addEdge("__start__", "resolve");
  
  // ✅ 4-way conditional routing after resolve (aligned with code job)
  // 1. isResume + hasTaskQueue + hasNewDirective → revise (task queue modification)
  // 2. isResume + hasTaskQueue (no new directive) → plan (continue from where we left off)
  // 3. isResume + !hasTaskQueue + hasDetectionReport → decompose (interrupted after detect but before decompose)
  // 4. !isResume (new job) → triage (full flow)
  graph.addConditionalEdges(
    "resolve" as any,
    ((s: DesignGraphState) => {
      const isResume = s.isResume === true;
      const hasTaskQueue = Boolean(s.taskQueue && !s.taskQueue.isEmpty());
      const hasDetectionReport = Boolean(s.detectionReport);
      const hasNewDirective = Boolean(s.overrideDirective);
      
      if (isResume && hasTaskQueue && hasNewDirective) {
        console.log(`🔀 [Resolve→Router] isResume + taskQueue + newDirective → revise`);
        return "revise";
      }
      if (isResume && hasTaskQueue) {
        console.log(`🔀 [Resolve→Router] isResume + taskQueue → plan (continue)`);
        return "plan";
      }
      if (isResume && hasDetectionReport) {
        console.log(`🔀 [Resolve→Router] isResume + detectionReport (no tasks) → decompose`);
        return "decompose";
      }
      
      console.log(`🔀 [Resolve→Router] New job → triage`);
      return "triage";
    }) as any,
    { triage: "triage", revise: "revise", plan: "plan", decompose: "decompose" } as any
  );
  
  // ✅ Triage → Conditional (proceed to detectEnvironment or end)
  graph.addConditionalEdges(
    "triage" as any,
    routeAfterTriage as any,
    {
      detectEnvironment: "detectEnvironment",  // work:proceed → continue
      __end__: "__end__"  // ask, redirect, blocked → end (await choice or show message)
    } as any
  );
  
  // ✅ Conditional routing from detectEnvironment
  // If error occurred (e.g., modification without documents), go to END
  // Otherwise, proceed to decompose
  graph.addConditionalEdges(
    "detectEnvironment" as any,
    ((s: DesignGraphState) => {
      if (s.designError) {
        console.log(`❌ [Graph] Design error detected, terminating job`);
        return "__end__";  // Terminate graph
      }
      return "decompose";  // Normal flow
    }) as any,
    { __end__: "__end__", decompose: "decompose" } as any
  );
  
  (graph as any).addEdge("decompose", "plan");
  (graph as any).addEdge("revise", "plan");  // ✅ revise always routes to plan
  (graph as any).addEdge("plan", "docGen");
  
  // ✅ Conditional routing: docGen → tool (if tool call) or checkTaskStatus (if done) or docGen (retry)
  graph.addConditionalEdges(
    "docGen" as any,
    ((s: DesignGraphState) => {
      // Check if there are pending tool calls
      const toolCalls = s.llmResponse?.toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        console.log(`🔧 [Graph] Tool call detected: ${toolCalls[0].name}`);
        return "tool";  // Execute tool
      }
      
      // ✅ CRITICAL: Check for explicit done signal (same pattern as Code Job)
      // Only complete task if LLM explicitly output <done>true</done>
      const isDone = s.llmResponse?.done === true;
      if (isDone) {
        return "checkTaskStatus";  // Task complete
      }
      
      // ✅ No tool calls and no explicit done → LLM response incomplete, retry
      console.warn(`⚠️  [Graph] No tool calls and done=${s.llmResponse?.done} - retrying docGen`);
      return "docGen";  // Retry (LLM will continue from conversation history)
    }) as any,
    { tool: "tool", checkTaskStatus: "checkTaskStatus", docGen: "docGen" } as any
  );
  
  // ✅ Tool → docGen (loop back for next LLM turn)
  (graph as any).addEdge("tool", "docGen");
  
  // ✅ Conditional routing: more tasks → plan, all done → learn
  graph.addConditionalEdges(
    "checkTaskStatus" as any,
    ((s: DesignGraphState) => {
      if (s.taskQueue && !s.taskQueue.isEmpty()) {
        return "plan";  // ← Next task
      } else {
        return "learn";  // ← All done
      }
    }) as any,
    { plan: "plan", learn: "learn" } as any
  );
  
  // ✅ CRITICAL: learn 노드 이후 END로 이동
  (graph as any).addEdge("learn", "__end__");

  return graph.compile();
}
